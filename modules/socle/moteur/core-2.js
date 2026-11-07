  // ---------- lecture d'une photo de facture (4.2.0) ----------
  // La partie testable du module : transformer ce qu'un service de lecture a cru voir en un achat
  // propre, et DIRE ce qui ne colle pas. Rien n'est enregistré ici — c'est l'utilisateur qui valide.
  // L'appel réseau lui-même vit dans main.js, et n'a lieu que si une clé a été saisie.

  function ocrNumber(v) {
    if (v == null || v === '') return 0;
    // « 1 234,56 DT », « 1.234,56 », « 1,234.56 » : on retire tout sauf les chiffres et le séparateur.
    let t = String(v).replace(/[^\d.,-]/g, '');
    const lastComma = t.lastIndexOf(','), lastDot = t.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      // Le dernier des deux est le séparateur décimal, l'autre sépare les milliers.
      if (lastComma > lastDot) t = t.replace(/\./g, '').replace(',', '.');
      else t = t.replace(/,/g, '');
    } else if (lastComma >= 0) {
      t = t.replace(/,/g, '.');
    }
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }

  // Ce qui a été lu, ramené à la forme d'un achat, avec la liste de ce qui mérite un coup d'œil.
  function ocrToPurchase(read, data, todayIso) {
    const r = read || {};
    const t = todayIso || today();
    const norm = x => (x || '').trim().toLowerCase();
    // Le matricule se compare sans ses séparateurs : « 1234567A/A/M/000 » sur la fiche et
    // « 1234567AAM000 » dans une facture électronique désignent la même entreprise (H1).
    const mf = x => String(x || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    // Le fournisseur se reconnaît d'abord au matricule (unique), ensuite au nom (approximatif).
    const supplier = (data.suppliers || []).find(s2 => r.matricule && mf(s2.matricule) && mf(s2.matricule) === mf(r.matricule))
      || (data.suppliers || []).find(s2 => r.supplier && norm(s2.name) === norm(r.supplier))
      || null;
    let lines = (Array.isArray(r.lines) ? r.lines : []).map(l => ({
      label: String(l.label || '').trim(),
      qty: ocrNumber(l.qty) || 1,
      unit: '',
      unitPrice: ocrNumber(l.unitPrice),
      vatRate: l.vatRate != null && l.vatRate !== '' && VAT_RATES.includes(ocrNumber(l.vatRate)) ? ocrNumber(l.vatRate) : 19,
      destination: 'charge', deductible: true
    })).filter(l => l.label || l.unitPrice);
    if (!lines.length) {
      lines = [{ label: r.subject || 'À compléter', qty: 1, unit: '', unitPrice: ocrNumber(r.totalHT),
        vatRate: 19, destination: 'charge', deductible: true }];
    }
    const computedHT = round3(lines.reduce((s2, l) => s2 + l.qty * l.unitPrice, 0));
    const readHT = r.totalHT == null ? null : ocrNumber(r.totalHT);
    const date = parseDateInput(r.date || '') || t;
    const warnings = [];
    if (!supplier) warnings.push(r.supplier ? `Fournisseur « ${r.supplier} » inconnu : à choisir ou à créer.` : 'Aucun fournisseur lu : à choisir.');
    if (!r.number) warnings.push('Aucun numéro de facture lu : il est obligatoire pour déduire la TVA.');
    if (readHT != null && Math.abs(round3(computedHT - readHT)) > 0.005) {
      // Les montants s'écrivent comme à l'écran (10.14.1, M-16), dans la devise de la société.
      const cur = ((data && data.company) || {}).currency || 'DT';
      warnings.push(`Les lignes totalisent ${money(computedHT, cur)} alors que la pièce annonce ${money(readHT, cur)}.`);
    }
    if (date > t) warnings.push('La date lue est dans le futur : vérifie-la.');
    return {
      head: {
        supplierId: supplier ? supplier.id : '',
        supplierName: supplier ? supplier.name : (r.supplier || ''),
        matricule: r.matricule || '',
        number: r.number || '',
        date,
        dueDate: parseDateInput(r.dueDate || '') || '',
        subject: r.subject || '',
        fees: ocrNumber(r.fees),
        // Ce qu'une facture électronique dit de plus qu'une photo (H1) : la devise, la nature (un avoir),
        // la facture qu'un avoir diminue et la référence de validation de la TTN.
        currency: r.currency ? normCurrency(r.currency) : '',
        kind: r.kind === 'avoir' ? 'avoir' : 'facture',
        refFacture: r.refFacture || '',
        refTtn: r.refTtn || ''
      },
      lines, computedHT, readHT, warnings
    };
  }

  // ---------- numéros de série, garanties et parc client (4.1.0) ----------
  // Un numéro de série est une unité physique qu'on peut suivre nommément : entrée par un achat,
  // sortie chez un client, sous garantie jusqu'à une date. C'est ce qui permet de répondre à
  // « depuis quand ce serveur est chez eux, et est-il encore garanti ? » sans fouiller un classeur.
  //
  // Le suivi par série ne remplace pas le stock en quantité : il le double pour les articles qui s'y
  // prêtent (du matériel), et `serialGap` signale quand les deux ne disent plus la même chose.

  const SERIAL_STATUSES = [
    ['stock', 'En stock'], ['vendu', 'Chez le client'], ['retour', 'Retourné'], ['hs', 'Hors service']
  ];
  const serialStatusLabel = k => (SERIAL_STATUSES.find(x => x[0] === k) || [, k])[1];
  // Durées de garantie couramment proposées. Le constructeur décide, pas l'application.
  const WARRANTY_CHOICES = [0, 6, 12, 24, 36, 60];

  function serializedItems(data) {
    return (data.catalog || []).filter(c => c.serialized);
  }

  // Fin de garantie : calculée à la SORTIE, pas à l'achat — la garantie du client court du jour où il
  // reçoit le matériel. Sans date de sortie, il n'y a pas encore de garantie à compter.
  function warrantyEnd(serial) {
    const months = Number(serial.warrantyMonths) || 0;
    if (!serial.outDate || !months) return '';
    return addDays(addMonths(serial.outDate, months, Number(serial.outDate.slice(8, 10))), -1);
  }

  function serialView(serial, data, todayIso) {
    const t = todayIso || today();
    const item = (data.catalog || []).find(c => c.id === serial.itemId) || {};
    const client = (data.clients || []).find(c => c.id === serial.clientId) || null;
    const end = warrantyEnd(serial);
    const days = end ? daysBetween(t, end) : null;
    return {
      ...serial, itemLabel: item.label || '', clientName: client ? client.name : '',
      warrantyEndDate: end,
      warrantyDays: days,
      underWarranty: !!end && end >= t,
      warrantyEndingSoon: !!end && end >= t && days <= 60,
      expired: !!end && end < t
    };
  }

  function serialList(data, filter, todayIso) {
    const f = filter || {};
    return (data.serials || []).map(x => serialView(x, data, todayIso))
      .filter(x => (!f.itemId || x.itemId === f.itemId)
        && (!f.clientId || x.clientId === f.clientId)
        && (!f.status || x.status === f.status))
      .sort((a, b) => (b.inDate || '').localeCompare(a.inDate || '') || TRI_NUMERIQUE.compare((a.serial || ''), b.serial || ''));
  }

  // Les unités disponibles pour une vente : en stock, jamais sorties.
  function availableSerials(data, itemId) {
    return (data.serials || []).filter(x => x.itemId === itemId && x.status === 'stock')
      .sort((a, b) => (a.inDate || '').localeCompare(b.inDate || '') || TRI_NUMERIQUE.compare((a.serial || ''), b.serial || ''));
  }

  // Le parc d'un client : ce qu'il a chez lui, depuis quand, garanti jusqu'à quand.
  function clientFleet(data, clientId, todayIso) {
    return serialList(data, { clientId, status: 'vendu' }, todayIso)
      .sort((a, b) => (b.outDate || '').localeCompare(a.outDate || ''));
  }

  // Les garanties qui se terminent bientôt : une fin de garantie est une occasion de proposer un
  // contrat de maintenance, pas une mauvaise nouvelle.
  function warrantiesEnding(data, days, todayIso) {
    const t = todayIso || today();
    const limit = addDays(t, days == null ? 60 : days);
    return serialList(data, { status: 'vendu' }, t)
      .filter(x => x.warrantyEndDate && x.warrantyEndDate >= t && x.warrantyEndDate <= limit)
      .sort((a, b) => a.warrantyEndDate.localeCompare(b.warrantyEndDate));
  }

  // (1.295.0) Une fin de garantie se propose UNE fois. La pièce faite depuis la page Garanties (un contrat de
  // maintenance, ou un devis) garde les numéros qu'elle couvre (`garanties`) : la page, l'accueil et la fiche du client
  // la retrouvent, et ne poussent plus à la refaire. Une pièce annulée ne compte plus : la garantie redevient à proposer.
  // L'index se fait en un seul passage sur les pièces (un calcul qui lit tout se fait en lot).
  function propositionsDeGarantie(data) {
    const m = new Map();
    for (const d of data.documents || []) {
      if ((d.type !== 'contrat' && d.type !== 'devis') || !Array.isArray(d.garanties) || !d.garanties.length) continue;
      if (d.status === 'annulé' || d.status === 'annulée') continue;
      for (const id of d.garanties) {
        const avant = m.get(id);
        if (!avant || (d.date || '') > (avant.date || '') || ((d.date || '') === (avant.date || '') && (d.createdAt || 0) > (avant.createdAt || 0))) m.set(id, d);
      }
    }
    return m;
  }
  // Ce qui reste à proposer : les garanties qui se terminent dans la fenêtre, sans pièce qui les propose. L'accueil et
  // la page comptent par cette même fonction (6.8.1).
  function garantiesAProposer(data, days, todayIso, index) {
    const ix = index || propositionsDeGarantie(data);
    return warrantiesEnding(data, days, todayIso).filter(x => !ix.has(x.id));
  }
  // Un client qui a plusieurs appareils en fin de garantie reçoit UNE proposition qui les nomme tous : un groupe par
  // client, dans l'ordre de la fin la plus proche. Un numéro sans client (livré sans fiche) reste seul.
  function garantiesParClient(items) {
    const g = new Map();
    for (const x of items) {
      const k = x.clientId || ('sans:' + x.id);
      if (!g.has(k)) g.set(k, { clientId: x.clientId || '', clientName: x.clientName || '', items: [] });
      g.get(k).items.push(x);
    }
    return [...g.values()].map(v => ({ ...v, items: v.items.slice().sort((a, b) => (a.warrantyEndDate || '').localeCompare(b.warrantyEndDate || '')) }))
      .map(v => ({ ...v, premiere: v.items[0].warrantyEndDate }))
      .sort((a, b) => a.premiere.localeCompare(b.premiere) || a.clientName.localeCompare(b.clientName, 'fr'));
  }
  // La ligne d'une proposition : l'appareil, son numéro, et le jour où la maintenance prend le relais de la garantie.
  // Le prix reste à zéro : SkanFact ne l'invente pas (la règle inconnue ne fait rien).
  function ligneDeMaintenance(x) {
    const relais = x.warrantyEndDate ? addDays(x.warrantyEndDate, 1) : '';
    // Le numéro va dans la description : la désignation reste courte (elle se lit en entier sur la pièce et le PDF).
    return { label: `Maintenance : ${x.itemLabel || 'appareil'}`,
      description: `N° de série ${x.serial || '—'}${relais ? ` · à partir du ${fmtDate(relais)}, à la fin de la garantie du constructeur` : ''}.` };
  }

  // Le stock compté en quantité et le stock compté en numéros doivent dire la même chose. Quand ils
  // divergent, c'est qu'un numéro n'a pas été saisi à l'entrée ou pas attribué à la sortie.
  function serialGap(data, itemId, todayIso) {
    const item = (data.catalog || []).find(c => c.id === itemId);
    if (!item || !item.serialized || !item.tracked) return null;
    const qty = stockOf(data, itemId, todayIso).qty;
    const serials = (data.serials || []).filter(x => x.itemId === itemId && x.status === 'stock').length;
    const gap = round3(qty - serials);
    return gap === 0 ? null : { itemId, label: item.label, qty, serials, gap };
  }

  function serialGaps(data, todayIso) {
    return serializedItems(data).map(c => serialGap(data, c.id, todayIso)).filter(Boolean);
  }

  // ---------- immobilisations et amortissements (3.5.0) ----------
  // Une immobilisation n'est pas une charge : elle reste dans l'entreprise et se déduit un peu chaque
  // année. Le module transforme une ligne d'achat marquée « immobilisation » en un bien amortissable,
  // et calcule la dotation de chaque exercice ainsi que la valeur nette comptable.
  //
  // Amortissement LINÉAIRE, prorata temporis au jour, base 360 (12 mois de 30 jours) : c'est la règle
  // tunisienne usuelle. La première annuité est réduite au nombre de jours d'utilisation de l'année de
  // mise en service, et la dernière reprend ce qui reste. À VÉRIFIER avec le comptable : les durées et
  // la règle de prorata dépendent de la nature du bien et du régime.

  // Familles proposées, avec la durée d'usage couramment admise. Aucune n'est imposée : l'utilisateur
  // change la durée bien par bien, et la bulle d'aide dit que c'est au comptable de trancher.
  // Le moteur d'amortissement vit dans `compta.js` depuis la 9.6.1 : aucune de ces fonctions ne
  // prend `data` — elles prennent un BIEN — et le Cabinet, qui ne charge pas core.js, en a besoin
  // pour les dossiers hors SkanFact. Réexportées ici à l'identique : les appelants n'ont pas bougé.
  const DEFAULT_ASSET_CLASSES = Compta.DEFAULT_ASSET_CLASSES;
  const assetClassLabel = Compta.assetClassLabel;
  const assetClassYears = Compta.assetClassYears;
  const days360 = Compta.days360;
  const assetSchedule = Compta.assetSchedule;
  const assetCumulated = Compta.assetCumulated;
  const assetYear = Compta.assetYear;
  const assetNBV = Compta.assetNBV;
  const disposalResult = Compta.disposalResult;
  const cappedCumulated = Compta.cappedCumulated;
  const entrySet = Compta.entrySet;
  // Les questions du cabinet (9.10.0), réexportées à l'IDENTITÉ : elles prennent une LISTE, pas
  // `data`, donc elles vivent dans compta.js (règle de découpage 9.1.0) et l'app entreprise les
  // lit ici. Une copie divergerait, et les deux applications ne diraient plus la même chose d'une
  // même question. Un test compare les objets, jamais leur résultat (9.6.1).
  const QUESTION_ATTENDUS = Compta.QUESTION_ATTENDUS;
  const QUESTION_RELANCE = Compta.QUESTION_RELANCE;
  const fusionnerQuestionsRecues = Compta.fusionnerQuestionsRecues;
  const questionsDeLaPiece = Compta.questionsDeLaPiece;
  const repondreQuestion = Compta.repondreQuestion;
  const reponsesAEnvoyer = Compta.reponsesAEnvoyer;
  const questionsSansReponse = Compta.questionsSansReponse;
  const reponsesApres = Compta.reponsesApres;
  const questionsValides = Compta.questionsValides;

  // ---------------------------------------------------------- l'origine d'un envoi du cabinet (10.13.0)
  //
  // Le dossier de clôture (.skanclose) et les questions (.skanask) arrivent SIGNÉS. Jusqu'ici, « Origine
  // vérifiée » voulait seulement dire « la signature correspond à la clé que le fichier présente » —
  // or n'importe qui peut fabriquer une paire de clés et signer un fichier au nom du cabinet : le
  // matricule du client est public. La clôture importée VERROUILLE un exercice ; la dire « vérifiée »
  // sur un fichier auto-signé, c'était prétendre ce qu'on ne peut pas prouver (Cabinet 1.0.0).
  //
  // La règle est celle que le Cabinet applique aux paquets de ses clients depuis la 9.2.0 (confiance
  // au premier usage, `cabcore.verdictOrigine`), vue de l'autre côté :
  //   1. signature fausse ou manifeste modifié → REFUSÉ ;
  //   2. pas de signature, rien de retenu → accepté, « origine non prouvée », en rouge ;
  //   3. pas de signature, une signature retenue → REFUSÉ : ne plus signer est une régression, ou
  //      quelqu'un d'autre ;
  //   4. signature valable, rien de retenu → accepté ET retenu (`epingler`) : les suivants lui seront
  //      comparés ;
  //   5. signature valable, la même → « origine vérifiée », et cette fois c'est vrai ;
  //   6. signature valable, une AUTRE → refusé en nommant les deux empreintes. La reprise passe par
  //      un geste humain (l'empreinte lue au téléphone), jamais par une acceptation automatique.
  //   epinglee : `data.cabinetSignature` ({ empreinte }) ou null
  //   origine  : ce que main.js a vérifié ({ niveau: 'prouvee'|'non-prouvee'|'refusee', empreinte, motif })
  function verdictEnvoiCabinet(epinglee, origine) {
    const pin = (epinglee && String(epinglee.empreinte || '')) || '';
    const o = origine || {};
    const recue = String(o.empreinte || '');
    if (o.niveau === 'refusee') {
      return { ok: false, etat: 'refusee',
        texte: `La signature de ce fichier n'est pas valable${o.motif ? ` (${String(o.motif).replace(/\.$/, '')})` : ''} : il a été modifié après son envoi, ou il ne vient pas de ton cabinet. Demande à ton comptable de te le renvoyer.` };
    }
    if (o.niveau !== 'prouvee') {
      return pin
        ? { ok: false, etat: 'signature-manquante',
            texte: `Ce fichier n'est pas signé, alors que les envois précédents de ton cabinet l'étaient (signature ${pin}). Rien ne prouve qu'il vient de lui : demande-lui de te le renvoyer depuis SkanFact Cabinet.` }
        : { ok: true, etat: 'non-prouvee', alerte: true,
            ligne: `ORIGINE NON PROUVÉE : ${o.motif || 'ce fichier n\'est pas signé.'} Vérifie avec ton comptable avant d'accepter.` };
    }
    if (!pin) {
      return { ok: true, etat: 'premiere', epingler: recue,
        ligne: `Signé par ton cabinet (signature ${recue}). C'est la première signature que tu reçois de lui : elle sera retenue, et les envois suivants lui seront comparés.` };
    }
    if (pin !== recue) {
      return { ok: false, etat: 'autre-cle', attendue: pin, recue,
        texte: `Ce fichier est signé par une autre clé que celle de ton cabinet.\n\nAttendue : ${pin}\nReçue : ${recue}\n\nSi ton comptable a changé de clé, fais-lui lire la nouvelle empreinte au téléphone avant de l'accepter : c'est la seule façon de savoir que le fichier vient de lui.` };
    }
    return { ok: true, etat: 'signe', ligne: `Origine vérifiée : signé par ton cabinet (signature ${recue}), la même que ses envois précédents.` };
  }

  // L'état des immobilisations pour un exercice : une ligne par bien, avec la dotation de l'année.
  function assetsList(data, year) {
    const y = Number(year) || Number(today().slice(0, 4));
    return (data.assets || []).map(a => {
      const v = assetYear(a, y);
      const dis = disposalResult(a);
      return {
        ...a, ...v,
        opening: round3(assetCumulated(a, `${y - 1}-12-31`)),
        disposalResult: dis,
        active: a.date <= `${y}-12-31` && !(dis && Number(dis.date.slice(0, 4)) < y)
      };
    }).filter(a => a.active).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  function assetTotals(data, year) {
    const rows = assetsList(data, year);
    const sum = (f) => round3(rows.reduce((s, r) => s + (Number(f(r)) || 0), 0));
    return {
      count: rows.length,
      gross: sum(r => r.amount),
      opening: sum(r => r.opening),
      annuity: sum(r => r.annuity),
      cumulated: sum(r => r.cumulated),
      // Au 31/12, un bien sorti dans l'année n'est plus à l'actif : sa DOTATION de l'année compte (c'est
      // une charge de l'exercice), sa valeur et son cumul non. Sans ces deux totaux, la carte « Valeur
      // d'acquisition » annonçait « 5 biens à l'actif » avec la valeur des six, et valeur − cumul ne
      // retombait pas sur la VNC, qui, elle, excluait déjà le bien sorti (10.14.0).
      grossActif: sum(r => r.out ? 0 : r.amount),
      cumulActif: sum(r => r.out ? 0 : r.cumulated),
      nbv: sum(r => r.out ? 0 : r.nbv),
      disposals: rows.filter(r => r.disposalResult && Number(r.disposalResult.date.slice(0, 4)) === Number(year)),
      rows
    };
  }

  // Les lignes d'achat marquées « immobilisation » qui n'ont pas encore de fiche : c'est le pont entre
  // le module Achats et celui-ci. On ne crée jamais la fiche tout seul — la durée d'amortissement est
  // une décision, pas une donnée.
  // Ce qu'une ligne « immobilisation » porte au compte d'immobilisation (10.14.0) : en DINARS (un bien
  // payé en euros entrait à son montant en euros) et TVA non déductible comprise. Sinon le 22 et le
  // tableau des biens divergent dès le premier achat en devise.
  function valeurLigneImmo(data, p, l) {
    const ht = (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
    const nd = tvaNonDeductible(l, p, data.company) ? ht * (Number(l.vatRate) || 0) / 100 : 0;
    return round3(toBase(p, round3(ht) + round3(nd), data.company || {}));
  }
  // Ce que les AVOIRS du fournisseur retirent de chaque ligne « immobilisation » d'un achat
  // (10.14.1). Un rabais sur une machine diminue son coût : l'écriture de l'avoir crédite le 22, et
  // la fiche proposée gardait le montant d'avant — le bilan disait 9 000, le tableau des biens 10 000,
  // et la dotation se calculait sur 10 000. Une ligne d'avoir se rattache à la ligne de l'achat qui
  // porte le même libellé, sinon à la seule ligne « immobilisation » de l'achat, sinon à la première.
  // `au` (10.14.1) borne les avoirs à une date : au 31/12, le 22 ne connaît que ceux qui y sont déjà
  // passés. Sans `au`, tous — c'est le montant d'aujourd'hui, celui qu'on propose pour la fiche.
  function reductionsImmo(data, p, au) {
    const lignes = (p.lines || []).map((l, i) => ({ l, i })).filter(x => x.l.destination === 'immobilisation');
    const out = {};
    if (!lignes.length) return out;
    const norme = v => String(v || '').trim().toLowerCase();
    const borne = String(au || '').slice(0, 10);
    (data.purchases || []).filter(a => a.kind === 'avoir' && a.achatLie === p.id && (!borne || (a.date || '') <= borne)).forEach(a => {
      (a.lines || []).filter(l => l.destination === 'immobilisation').forEach(l => {
        const cible = lignes.find(x => norme(x.l.label) && norme(x.l.label) === norme(l.label)) || lignes[0];
        out[cible.i] = round3((out[cible.i] || 0) + valeurLigneImmo(data, a, l));
      });
    });
    return out;
  }
  function assetsToCreate(data) { return immosEnAttente(data, ''); }
  // La ligne d'achat qu'une fiche représente (10.14.1). `lineIndex` la désigne depuis la 3.5.0 ; une
  // fiche liée à un achat SANS lui (des données écrites à la main, un import, une copie) se rattache à
  // la seule ligne « immobilisation » de l'achat, sinon à celle qui porte son libellé. Sans ce repli,
  // l'achat restait « à immobiliser » à côté de sa fiche — et en créer une seconde amortissait le
  // bien deux fois. -1 : aucune ligne ne lui correspond.
  function ligneDeFiche(a, p) {
    if (!a || !p) return -1;
    const lignes = (p.lines || []).map((l, i) => ({ l, i })).filter(x => x.l.destination === 'immobilisation');
    const n = Number(a.lineIndex);
    if (a.lineIndex !== null && a.lineIndex !== undefined && a.lineIndex !== '' && Number.isInteger(n) && lignes.some(x => x.i === n)) return n;
    if (lignes.length === 1) return lignes[0].i;
    const norme = v => String(v || '').trim().toLowerCase();
    const m = lignes.find(x => norme(x.l.label) && norme(x.l.label) === norme(a.label));
    return m ? m.i : -1;
  }
  // Les mêmes, À UNE DATE (10.14.1) : achetées au plus tard ce jour-là, au montant que le 22 porte
  // ce jour-là (les avoirs postérieurs ne l'ont pas encore diminué). Sans `au`, toutes, au montant
  // d'aujourd'hui : c'est la liste « à immobiliser ».
  function immosEnAttente(data, au) {
    const borne = String(au || '').slice(0, 10);
    const achats = new Map((data.purchases || []).map(p => [p.id, p]));
    const done = new Set((data.assets || []).filter(a => a.purchaseId).map(a => `${a.purchaseId}#${ligneDeFiche(a, achats.get(a.purchaseId))}`));
    const out = [];
    (data.purchases || []).forEach(p => {
      // Un acompte n'est pas un bien reçu (il se reprend sur la facture, qui, elle, propose la
      // fiche) ; un avoir n'est pas une acquisition. Les deux proposaient une fiche de plus.
      if (p.kind === 'acompte' || p.kind === 'avoir') return;
      if (borne && (p.date || '') > borne) return;
      const moins = reductionsImmo(data, p, borne);
      (p.lines || []).forEach((l, i) => {
        if (l.destination !== 'immobilisation') return;
        if (done.has(`${p.id}#${i}`)) return;
        const amount = round3(valeurLigneImmo(data, p, l) - (moins[i] || 0));
        if (amount <= 0) return;
        out.push({ purchaseId: p.id, lineIndex: i, label: l.label || '', amount, date: p.date, supplierId: p.supplierId, number: p.number || '' });
      });
    });
    return out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
  // Ce que le compte 22 porte au 31/12 et que le tableau des biens de l'exercice ne montre pas
  // (10.14.1). Le tableau se tient par MISE EN SERVICE, le 22 par ACHAT : une ligne d'achat
  // « immobilisation » sans fiche y est depuis l'achat — et son amortissement nulle part —, un bien
  // acheté en décembre et mis en service en janvier aussi. Regardé un 1er janvier, l'exemple disait
  // 53 950 au bilan et 52 500 sur la page Immobilisations, sans un mot, et l'invariant qui compare
  // les deux tombait chaque début d'année. L'inverse existe : un bien mis en service AVANT sa
  // facture est au tableau et pas encore au 22.
  //  - `sansFiche` et `pasEnService` : au 22, pas au tableau — au montant que le 22 porte ;
  //  - `avantFacture` : au tableau, pas encore au 22 — au montant de la fiche, celui du tableau.
  function immosHorsTableau(data, year) {
    const fin = `${Number(year)}-12-31`;
    const achats = new Map((data.purchases || []).map(p => [p.id, p]));
    const sansFiche = immosEnAttente(data, fin);
    const pasEnService = [], avantFacture = [];
    (data.assets || []).forEach(a => {
      const p = a.purchaseId && achats.get(a.purchaseId);
      const idx = ligneDeFiche(a, p);
      const l = p && (p.lines || [])[idx];
      if (!l || l.destination !== 'immobilisation' || !a.date || !p.date) return;
      // Sorti avant la fin de l'exercice : ni au tableau, ni au 22.
      if (a.disposal && a.disposal.date && a.disposal.date <= fin) return;
      const achete = p.date <= fin, enService = a.date <= fin;
      if (achete && !enService) {
        const amount = round3(valeurLigneImmo(data, p, l) - (reductionsImmo(data, p, fin)[idx] || 0));
        if (amount > 0) pasEnService.push({ assetId: a.id, label: a.label || l.label || '', amount, date: p.date, miseEnService: a.date, number: p.number || '' });
      } else if (!achete && enService) {
        avantFacture.push({ assetId: a.id, label: a.label || l.label || '', amount: round3(Number(a.amount) || 0), date: p.date, miseEnService: a.date, number: p.number || '' });
      }
    });
    const somme = rows => round3(rows.reduce((t, r) => t + r.amount, 0));
    return { sansFiche, pasEnService, avantFacture,
      auBilan: round3(somme(sansFiche) + somme(pasEnService)), horsBilan: somme(avantFacture),
      vide: !sansFiche.length && !pasEnService.length && !avantFacture.length };
  }
  // Les biens déjà créés au montant d'AVANT un avoir du fournisseur (10.14.1) : la fiche porte encore
  // la valeur de la ligne d'achat, le 22 la valeur diminuée. On ne corrige pas la fiche d'office —
  // elle a pu être ajustée à la main pour une autre raison (des frais d'installation) — on la NOMME
  // quand elle est restée exactement au montant brut.
  function biensADiminuer(data) {
    const achats = new Map((data.purchases || []).map(p => [p.id, p]));
    return (data.assets || []).map(a => {
      const p = a.purchaseId && achats.get(a.purchaseId);
      const idx = ligneDeFiche(a, p);
      const l = p && (p.lines || [])[idx];
      if (!l || l.destination !== 'immobilisation') return null;
      const moins = reductionsImmo(data, p)[idx] || 0;
      const brut = valeurLigneImmo(data, p, l);
      if (!moins || Math.abs(round3(Number(a.amount) || 0) - brut) > 0.0005) return null;
      return { assetId: a.id, label: a.label || l.label || '', montant: brut, attendu: round3(brut - moins), moins };
    }).filter(Boolean);
  }

  // Dotation de la PÉRIODE : c'est elle qui manquait au résultat simplifié et au seuil de rentabilité.
  // Une immobilisation n'est pas une charge de l'année de l'achat, mais son amortissement EST une charge
  // de chaque exercice.
  //
  // Attention au piège : la page Comptabilité peut demander un seul mois. Retourner la dotation de
  // l'année entière ferait un résultat mensuel catastrophique et faux (c'est arrivé). On calcule donc
  // la dotation exactement sur la période demandée, par différence de cumuls.
  function depreciationFor(data, period) {
    if (!period || !period.from || !period.to) return 0;
    const y = Number(period.from.slice(0, 4));
    // Année civile complète : on reprend le chiffre du tableau des amortissements, au millime près,
    // pour que la page Comptabilité et la page Immobilisations ne se contredisent jamais.
    if (period.from === `${y}-01-01` && period.to === `${y}-12-31`) return assetTotals(data, y).annuity;
    // Les bornes se lisent en base 360 : un mois entier vaut trente jours, février compris. Lu tel
    // quel, le 28 février donnait vingt-huit jours à février et trente-deux à mars (10.14.0).
    const before = fin360(addDays(period.from, -1));
    const to = fin360(period.to);
    return round3((data.assets || []).reduce((s, a) =>
      s + Math.max(0, round3(cappedCumulated(a, to) - cappedCumulated(a, before))), 0));
  }
  // Le dernier jour de février devient le 30 : c'est le seul mois que `days360` (qui ramène le 31 à
  // 30) ne compte pas entier. Tout autre jour reste tel quel — une mise en service ou une cession
  // le 28 février garde ses jours réels, comme dans le tableau des amortissements.
  function fin360(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return iso;
    const [yy, mm, dd] = iso.split('-').map(Number);
    return dd < 30 && dd === daysInMonth(yy, mm) ? `${iso.slice(0, 8)}30` : iso;
  }

  // ---------- trésorerie (3.3.0) ----------
  // « Tu vois ce qu'on te doit, tu ne vois pas ce que tu as. » Ce bloc répond à la seule question qui
  // tue les entreprises rentables : est-ce que j'aurai de quoi payer le mois prochain ?
  //
  // Principe : aucune saisie en double. Les mouvements sont DÉDUITS des paiements clients et des
  // règlements fournisseurs déjà enregistrés. On n'ajoute que ce qui n'existe nulle part ailleurs :
  // les comptes, le solde de départ, et les mouvements libres (salaires, impôts, apports, retraits).

  const ACCOUNT_KINDS = [['banque', 'Compte bancaire'], ['caisse', 'Caisse espèces'], ['autre', 'Autre']];
  // Nature d'un mouvement saisi à la main — ce qui ne vient ni d'une facture ni d'un achat.
  const MOVE_KINDS = [
    ['salaire', 'Salaires et charges', -1], ['impot', 'Impôts et taxes', -1], ['banque', 'Frais bancaires', -1],
    ['retrait', 'Retrait ou dividende', -1], ['emprunt', 'Échéance d\'emprunt', -1], ['autre-sortie', 'Autre sortie', -1],
    ['apport', 'Apport ou subvention', 1], ['pret', 'Déblocage de prêt', 1], ['autre-entree', 'Autre entrée', 1],
    ['virement', 'Virement entre mes comptes', -1]
  ];
  const moveSign = kind => { const m = MOVE_KINDS.find(x => x[0] === kind); return m ? m[2] : -1; };
  // Les deux côtés d'un virement entre deux comptes de l'entreprise (10.14.1) : chacun est un compte
  // qui EXISTE, ou ''. Un côté dont le compte a été supprimé n'est plus rien : l'autre garde ce que
  // SON relevé dit (la banque qui a vraiment reçu 300 DT les garde), et la contrepartie va au compte
  // d'attente — le comptable la verra, rien ne se perd en silence. La 10.14.0 faisait basculer un
  // départ supprimé sur le compte par défaut : quand l'arrivée ÉTAIT ce compte, le virement devenait
  // « de la Banque à la Banque », traité en sortie — 300 DT reçus devenaient 300 DT perdus.
  // Un départ jamais choisi (saisi avant tout compte) est le compte par défaut, comme pour tout
  // mouvement ; un virement d'un compte à lui-même ne déplace rien (`neutre`).
  function virementCotes(data, m) {
    if (!m || m.kind !== 'virement') return null;
    const comptes = (data && data.accounts) || [];
    const existe = id => !!id && comptes.some(a => a.id === id);
    const defaut = comptes.find(a => a.isDefault) || comptes[0];
    const vers = existe(String(m.versAccountId || '')) ? String(m.versAccountId) : '';
    let depart = existe(m.accountId) ? m.accountId : '';
    // Sans départ connu : le compte par défaut quand le départ n'a jamais été choisi, ou quand
    // AUCUN des deux côtés n'existe plus (le mouvement reste alors une sortie à ventiler).
    if (!depart && (!m.accountId || !vers)) depart = defaut ? defaut.id : '';
    return { depart, vers, neutre: !!depart && depart === vers };
  }
  // Le compte d'arrivée d'un virement, ou '' (10.14.0) : le seul lecteur qui n'a besoin que de lui.
  function virementVers(data, m) {
    const c = virementCotes(data, m);
    return c && !c.neutre && c.depart ? c.vers : '';
  }

  // 10.14.0 — Le compte bancaire naît de la FICHE SOCIÉTÉ. L'entreprise a déjà donné sa banque et
  // son RIB (la fiche, « Tes premiers pas ») ; les retaper dans la Trésorerie, c'est la ressaisie
  // que SkanFact promet d'éviter. UNE fonction pour les trois portes — le paiement sans compte,
  // l'état vide de la Trésorerie, « + Compte » — parce que deux copies de ce préremplissage avaient
  // déjà divergé : le paiement le posait depuis la 10.12.0, et la Trésorerie, la page faite pour
  // ça, ouvrait un compte vide.
  // Rend null quand la fiche ne dit rien, ou quand un compte porte déjà ce RIB : on ne propose pas
  // deux fois le même compte. Un RIB se compare sans ses espaces, et un IBAN tunisien (TN59 suivi
  // des vingt chiffres) désigne le même compte que son RIB.
  function compteDepuisFiche(company, accounts) {
    const co = company || {};
    const banque = String(co.bank || '').trim();
    const rib = String(co.rib || '').trim();
    if (!banque && !rib) return null;
    const norme = s => String(s || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const cle = norme(rib);
    const meme = a => {
      const k = norme(a.rib);
      if (cle && k) return k === cle || (k.length >= 20 && cle.length >= 20 && (k.endsWith(cle) || cle.endsWith(k)));
      return !cle && !!banque && String(a.bank || '').trim().toLowerCase() === banque.toLowerCase();
    };
    if ((accounts || []).some(meme)) return null;
    return { name: banque ? `${banque} — compte courant` : 'Compte courant', kind: 'banque', bank: banque, rib };
  }

  // Tous les mouvements réels d'une période, quelle que soit leur origine. Un mouvement porte
  // toujours un compte : sans compte affecté, il est rattaché au compte par défaut.
  function cashMovements(data, company, period, accountId) {
    const out = [];
    const defaultAccount = (data.accounts || []).find(a => a.isDefault) || (data.accounts || [])[0];
    const fallback = defaultAccount ? defaultAccount.id : '';
    // Le compte d'une ligne : celui qu'elle nomme s'il existe encore, sinon le compte par défaut
    // (10.14.0). Supprimer un compte promet « ses mouvements basculeront sur le compte par défaut » ;
    // la Trésorerie gardait pourtant l'identifiant disparu, et ces lignes ne tombaient plus dans
    // aucun compte — pendant que les écritures (`journalDeCompte`) les passaient bien au compte par
    // défaut : la banque de la page et celle du grand livre ne disaient plus la même chose.
    const existants = new Set((data.accounts || []).map(a => a.id));
    const compteDe = id => (id && existants.has(id)) ? id : fallback;
    const keep = id => !accountId || compteDe(id) === accountId;
    const clientName = id => ((data.clients || []).find(c => c.id === id) || {}).name || '—';
    const supplierName = id => ((data.suppliers || []).find(s => s.id === id) || {}).name || '—';

    (data.documents || []).filter(d => d.type === 'facture').forEach(d => (d.payments || []).forEach(p => {
      if (!inPeriod(p.date, period && period.from, period && period.to) || !keep(p.accountId)) return;
      const rend = estRemboursement(p);
      out.push({
        id: p.id, kind: rend ? 'decaissement' : 'encaissement', date: p.date, accountId: compteDe(p.accountId),
        label: `${rend ? 'Remboursement' : 'Encaissement'} ${d.number || ''}`.trim(), party: clientName(d.clientId),
        amount: montantRegle(d, p, company), method: p.method || '',
        reference: p.reference || '', docId: d.id, reconciled: !!p.reconciled, source: 'vente'
      });
    }));
    (data.purchases || []).forEach(pu => (pu.payments || []).forEach(p => {
      if (!inPeriod(p.date, period && period.from, period && period.to) || !keep(p.accountId)) return;
      // Un règlement porté par un AVOIR est un remboursement : l'argent ENTRE (10.2.0) — le journal
      // (`supplierPayments`) le savait, la Trésorerie non : elle le sortait du compte, et la banque
      // de la page et celle du grand livre différaient de deux fois le remboursement (10.14.0). Un
      // règlement NÉGATIF sur une facture trop payée est le même geste : le fournisseur rend.
      const montant = -round3((pu.kind === 'avoir' ? -1 : 1) * montantRegle(pu, p, company));
      const rendu = montant > 0;
      out.push({
        id: p.id, kind: rendu ? 'encaissement' : 'decaissement', date: p.date, accountId: compteDe(p.accountId),
        label: `${rendu ? 'Remboursement' : 'Règlement'} ${pu.number || 'd\'un achat sans numéro'}`, party: supplierName(pu.supplierId),
        // Ce qui sort du compte sort en DINARS (10.1.0), comme l'encaissement client dix lignes
        // plus haut : régler 500 € vide le compte de 1 700 DT, pas de 500. Sans ça, la trésorerie
        // de la page et celle du grand livre se contredisaient — et c'est le test des états
        // financiers qui l'a dit, pas la relecture.
        amount: montant, method: p.method || '',
        reference: p.reference || '', purchaseId: pu.id, reconciled: !!p.reconciled, source: 'achat'
      });
    }));
    // Un bulletin réglé est une sortie d'argent : elle remonte toute seule, comme un paiement client.
    // C'est pour ça qu'il ne faut PAS saisir en plus un mouvement libre « Salaires » pour le même mois —
    // `todoList` le signale si les deux existent.
    (data.payslips || []).forEach(sl => {
      if (!sl.paidDate || !inPeriod(sl.paidDate, period && period.from, period && period.to) || !keep(sl.accountId)) return;
      const emp = (data.employees || []).find(e => e.id === sl.employeeId) || {};
      const net = ((sl.computed || {}).net) || 0;
      if (!net) return;
      out.push({
        id: 'pay-' + sl.id, kind: 'sortie', date: sl.paidDate, accountId: compteDe(sl.accountId),
        label: `Salaire ${monthLabel(payslipDate(sl))}`, party: emp.name || 'Salarié',
        amount: -round3(net), method: sl.method || 'virement', reference: sl.reference || '',
        payslipId: sl.id, reconciled: !!sl.reconciled, source: 'paie'
      });
    });
    // 10.14.0 : une AVANCE sur salaire est de l'argent qui sort le jour où on la verse. Elle ne
    // remontait nulle part — ni ici, ni dans les écritures : la banque de la Trésorerie et celle du
    // grand livre étaient toutes deux trop hautes du montant avancé, et le 425 gardait pour toujours
    // les retenues qui la remboursent. Le remboursement, lui, est déjà dans le net versé plus bas.
    (data.advances || []).forEach(a => {
      const montant = round3(Number(a.amount) || 0);
      if (!montant || !inPeriod(a.date, period && period.from, period && period.to) || !keep(a.accountId)) return;
      const emp = (data.employees || []).find(e => e.id === a.employeeId) || {};
      out.push({
        id: 'av-' + a.id, kind: 'sortie', date: a.date, accountId: compteDe(a.accountId),
        label: 'Avance sur salaire', party: emp.name || 'Salarié',
        amount: -montant, method: a.method || 'virement', reference: a.reference || '',
        advanceId: a.id, reconciled: !!a.reconciled, source: 'avance'
      });
    });
    // (plateforme) 1.228.0 — une déclaration sociale PAYÉE (la CNSS du trimestre, les retenues et taxes d'un mois) est de
    // l'argent qui sort : « Marquer déposée » ne gardait qu'une date, la trésorerie ne voyait jamais partir la CNSS ni la
    // retenue, et le grand livre gardait ces dettes pour toujours. Le montant est celui de la déclaration, figé au paiement.
    (data.socialFilings || []).forEach(f => {
      const montant = round3(Number(f.amount) || 0);
      if (!f.paidDate || !montant || !inPeriod(f.paidDate, period && period.from, period && period.to) || !keep(f.accountId)) return;
      out.push({
        id: 'soc-' + f.id, kind: 'sortie', date: f.paidDate, accountId: compteDe(f.accountId),
        label: f.label || 'Déclaration sociale', party: /^cnss-/.test(f.id) ? 'CNSS' : 'Recette des finances',
        amount: -montant, method: f.method || 'virement', reference: f.reference || '',
        socialId: f.id, reconciled: !!f.reconciled, source: 'social'
      });
    });
    // (plateforme) 1.230.0 — ce qu'une saisie sur salaire a retenu, VERSÉ au créancier : de l'argent qui sort, le jour du
    // versement. La retenue elle-même ne sort rien (elle diminue le net versé au salarié).
    (data.employees || []).forEach(emp => (Array.isArray(emp.saisies) ? emp.saisies : []).forEach(x => (x.versements || []).forEach(v => {
      const montant = round3(Number(v.amount) || 0);
      if (!montant || !v.date || !inPeriod(v.date, period && period.from, period && period.to) || !keep(v.accountId)) return;
      out.push({
        id: `sai-${x.id}-${v.id}`, kind: 'sortie', date: v.date, accountId: compteDe(v.accountId),
        label: `Saisie sur salaire — ${emp.name || ''}`.trim(), party: String(x.creancier || '').trim() || 'Créancier',
        amount: -montant, method: v.method || 'virement', reference: v.reference || x.reference || '',
        saisieId: x.id, employeeId: emp.id, reconciled: !!v.reconciled, source: 'saisie'
      });
    })));
    // Un VIREMENT entre deux comptes de l'entreprise (10.14.0) — la banque qui alimente la caisse, la
    // caisse déposée à la banque — sort de l'un et entre dans l'autre : deux lignes, une par compte,
    // chacune pointée sur SON relevé (`reconciled` au départ, `reconciledVers` à l'arrivée). Sans
    // cette nature, le seul geste proposé pour alimenter la caisse était « Retrait », qui passe au
    // compte courant de l'associé : la caisse ne recevait rien, et le gérant devait l'argent.
    const nomCompte = id => ((data.accounts || []).find(a => a.id === id) || {}).name || 'un autre compte';
    (data.movements || []).forEach(m => {
      if (!inPeriod(m.date, period && period.from, period && period.to)) return;
      const label = (MOVE_KINDS.find(k => k[0] === m.kind) || [null, 'Mouvement'])[1];
      const montant = round3(Math.abs(Number(m.amount) || 0));
      const cotes = virementCotes(data, m);
      if (cotes && cotes.neutre) return;      // d'un compte à lui-même : rien ne bouge
      const vers = cotes ? cotes.vers : '';
      const depart = cotes ? cotes.depart : compteDe(m.accountId);
      if (depart && keep(depart)) out.push({
        id: m.id, kind: moveSign(m.kind) > 0 ? 'entree' : 'sortie', date: m.date, accountId: depart,
        label: m.label || (vers ? `Virement vers ${nomCompte(vers)}` : label), party: label, amount: round3(moveSign(m.kind) * montant),
        method: m.method || '', reference: m.reference || '', movementId: m.id, reconciled: !!m.reconciled, source: 'libre', virement: !!vers
      });
      if (vers && keep(vers)) out.push({
        id: m.id + '~vers', kind: 'entree', date: m.date, accountId: vers,
        label: m.label || (depart ? `Virement depuis ${nomCompte(depart)}` : 'Virement depuis un compte supprimé'), party: label, amount: montant,
        method: m.method || '', reference: m.reference || '', movementId: m.id, reconciled: !!m.reconciledVers, source: 'libre', virement: true, arrivee: true
      });
    });
    return out.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.label || '').localeCompare(b.label || ''));
  }

  // Solde d'un compte à une date : son solde de départ plus tous les mouvements jusque-là.
  function accountBalance(data, company, accountId, toIso) {
    const acc = (data.accounts || []).find(a => a.id === accountId);
    if (!acc) return { opening: 0, movements: 0, balance: 0, count: 0 };
    const moves = cashMovements(data, company, { from: acc.openingDate || '', to: toIso || '9999-12-31' }, accountId);
    const sum = round3(moves.reduce((s, m) => s + m.amount, 0));
    // Le solde de départ n'existe qu'à partir de sa date (10.14.0) : un compte ouvert le 1er octobre
    // ne porte rien le 25 septembre. Le compté d'office, la Trésorerie annonçait un solde que les
    // écritures (qui posent l'ouverture à sa date) ne portaient pas — la banque du grand livre et
    // celle de la Trésorerie ne disaient plus la même chose.
    const ouvert = !acc.openingDate || !toIso || String(toIso) >= String(acc.openingDate);
    const opening = ouvert ? round3(Number(acc.opening) || 0) : 0;
    return { opening, movements: sum, balance: round3(opening + sum), count: moves.length };
  }

  // Tableau de bord de tous les comptes, avec la part non pointée sur le relevé.
  function cashPosition(data, company, todayIso) {
    const t = todayIso || today();
    const accounts = (data.accounts || []).map(a => {
      const b = accountBalance(data, company, a.id, t);
      const all = cashMovements(data, company, { from: a.openingDate || '', to: t }, a.id);
      const pending = round3(all.filter(m => !m.reconciled).reduce((s, m) => s + m.amount, 0));
      return { ...a, ...b, pending, reconciled: round3(b.balance - pending) };
    });
    return { accounts, total: round3(accounts.reduce((s, a) => s + a.balance, 0)) };
  }

  // (1.266.0) Le délai réel d'un client : de combien de jours, en moyenne, il paie après l'échéance — mesuré sur ses six
  // dernières factures soldées (la date du dernier paiement qui la solde). Moins de deux factures : on ne sait pas (null).
  // Un client qui paie en avance compte zéro : on n'attend jamais l'argent avant la date de la facture.
  function delaiClient(data, company, clientId, todayIso) {
    const t = todayIso || today();
    const soldees = [];
    (data.documents || []).filter(d => d.type === 'facture' && d.clientId === clientId && d.status !== 'brouillon' && d.status !== 'annulée').forEach(d => {
      if (invoiceBalance(d, data, company).remaining > 0.0005) return;
      const ps = (d.payments || []).filter(p => !estRemboursement(p) && p.date && p.date <= t).map(p => p.date).sort();
      if (!ps.length) return;
      soldees.push({ le: ps[ps.length - 1], retard: Math.max(0, daysBetween(d.dueDate || d.date, ps[ps.length - 1])) });
    });
    soldees.sort((a, b) => b.le.localeCompare(a.le));
    const r = soldees.slice(0, 6);
    if (r.length < 2) return null;
    return { jours: Math.round(r.reduce((x, s) => x + s.retard, 0) / r.length), factures: r.length };
  }

  // (1.266.0) Le portefeuille des effets : les chèques et les traites reçus (ou remis) dont l'échéance n'est pas arrivée.
  // L'effet porte sa date de réception (`effet.recuLe`) ; le règlement, lui, est daté de son échéance — le jour où l'argent
  // passe sur le compte : c'est cette date que la trésorerie et le journal de banque lisent (À VÉRIFIER avec le
  // comptable : le compte d'effets à recevoir, 413 / 4131, n'est pas encore tenu à part).
  function portefeuilleEffets(data, company, todayIso) {
    const t = todayIso || today();
    const out = [];
    const nomC = id => ((data.clients || []).find(c => c.id === id) || {}).name || '—';
    const nomF = id => ((data.suppliers || []).find(c => c.id === id) || {}).name || '—';
    (data.documents || []).filter(d => d.type === 'facture').forEach(d => (d.payments || []).forEach(p => {
      if (!p.effet || !p.date || p.date <= t) return;
      out.push({ sens: 'recevoir', id: p.id, docId: d.id, piece: d.number || '', tiers: nomC(d.clientId), type: p.method, numero: p.reference || '', recuLe: p.effet.recuLe || '', echeance: p.date, montant: round3(montantRegle(d, p, company)) });
    }));
    (data.purchases || []).forEach(pu => (pu.payments || []).forEach(p => {
      if (!p.effet || !p.date || p.date <= t) return;
      out.push({ sens: 'payer', id: p.id, purchaseId: pu.id, piece: pu.number || '', tiers: nomF(pu.supplierId), type: p.method, numero: p.reference || '', recuLe: p.effet.recuLe || '', echeance: p.date, montant: round3(montantRegle(pu, p, company)) });
    }));
    out.sort((a, b) => a.echeance.localeCompare(b.echeance));
    const tot = sens => round3(out.filter(x => x.sens === sens).reduce((s, x) => s + x.montant, 0));
    return { effets: out, aRecevoir: tot('recevoir'), aPayer: tot('payer') };
  }

  // (1.298.0) La nature proposée pour une ligne du relevé qu'on crée en mouvement, devinée de son libellé : les frais de la
  // banque (« FRAIS », « COMMISSION », « AGIOS », « TENUE DE COMPTE ») et les impôts payés (« IMPOT », « TVA », « CNSS »,
  // « RECETTE DES FINANCES »). Ce n'est qu'une proposition, corrigée d'un clic dans la fenêtre ; sans indice, le sens dit
  // « Autre entrée » ou « Autre sortie ». Une entrée n'est jamais classée en frais : un remboursement de frais reste une
  // entrée à décider.
  function natureDuReleve(libelle, montant) {
    const t = String(libelle || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (Number(montant) > 0) return 'autre-entree';
    if (/\b(FRAIS|COMMISSIONS?|AGIOS?|TENUE DE COMPTE|COTISATION CARTE|INTERETS? DEBITEURS?)\b/.test(t)) return 'banque';
    if (/\b(IMPOTS?|TVA|CNSS|RECETTE DES FINANCES|ACOMPTE PROVISIONNEL|TAXE)\b/.test(t)) return 'impot';
    return 'autre-sortie';
  }

  // (1.266.0) Un relevé de banque face aux mouvements d'un compte : chaque ligne du relevé cherche le mouvement pas encore
  // pointé de MÊME montant (au millime), le plus proche en date à cinq jours près, pris une seule fois. Faute de quoi, elle
  // cherche parmi ceux DÉJÀ pointés : un relevé importé recouvre souvent des jours déjà rapprochés, et dire « absente de
  // SkanFact » d'une ligne pointée la semaine dernière ferait créer un doublon. Ce qui reste est « absent de SkanFact » (un
  // prélèvement, des frais) ; un mouvement sans ligne reste à pointer.
  function apparierReleve(lignes, mouvements, joursMax) {
    const max = Number(joursMax) >= 0 ? Number(joursMax) : 5;
    const libres = (mouvements || []).filter(m => !m.reconciled).map(m => ({ m, pris: false }));
    const pointes = (mouvements || []).filter(m => m.reconciled).map(m => ({ m, pris: false }));
    const paires = [], dejaPointees = [], absentes = [];
    const chercher = (l, l2) => {
      let meilleur = null, ecart = Infinity;
      l2.forEach(x => {
        if (x.pris || Math.abs(round3(x.m.amount) - round3(l.montant)) > 0.0005) return;
        const j = Math.abs(daysBetween(x.m.date, l.date));
        if (j <= max && j < ecart) { meilleur = x; ecart = j; }
      });
      if (meilleur) meilleur.pris = true;
      return meilleur ? { ligne: l, mouvement: meilleur.m, jours: ecart } : null;
    };
    (lignes || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(l => {
      const p = chercher(l, libres);
      if (p) { paires.push(p); return; }
      const d = chercher(l, pointes);
      if (d) dejaPointees.push(d); else absentes.push(l);
    });
    // (1.298.0, revue de la Trésorerie) Une remise de chèques : la banque crédite en UNE ligne les chèques déposés ensemble
    // (« REMISE CHEQUES 3 CHQ »), que SkanFact porte un par un, chacun sur sa facture. Une ligne restée seule cherche deux à
    // quatre mouvements pas encore pointés, du même sens, datés des vingt jours qui la précèdent (à `max` jours près après),
    // dont la somme fait la ligne au millime ; seule une combinaison UNIQUE se propose (la règle de la Banque du Cabinet :
    // au-delà de quatre, ou à deux réponses, la somme ne prouve plus rien). Sans elle, la ligne passait pour absente de
    // SkanFact, et « Créer le mouvement » comptait l'encaissement deux fois (vu le 06/11/2026, Menuiserie Ben Salah).
    const remises = [];
    const seules = absentes.filter(l => {
      const cible = Math.round(Math.abs(Number(l.montant) || 0) * 1000);
      const signe = Math.sign(Number(l.montant) || 0);
      if (!cible || !signe || !l.date) return true;
      const cands = libres.filter(x => !x.pris && Math.sign(Number(x.m.amount) || 0) === signe && x.m.date
        && x.m.date >= addDays(l.date, -20) && x.m.date <= addDays(l.date, max))
        .sort((a, b) => Math.abs(daysBetween(a.m.date, l.date)) - Math.abs(daysBetween(b.m.date, l.date)))
        .slice(0, 20).map(x => ({ x, v: Math.round(Math.abs(Number(x.m.amount) || 0) * 1000) }));
      const trouvees = [];
      const essayer = (debut, cheques, somme) => {
        if (trouvees.length > 1) return;
        if (cheques.length >= 2 && somme === cible) { trouvees.push(cheques.slice()); return; }
        if (cheques.length === 4 || somme >= cible) return;
        for (let i = debut; i < cands.length; i++) { cheques.push(cands[i]); essayer(i + 1, cheques, somme + cands[i].v); cheques.pop(); }
      };
      essayer(0, [], 0);
      if (trouvees.length !== 1) return true;
      trouvees[0].forEach(c => { c.x.pris = true; });
      remises.push({ ligne: l, mouvements: trouvees[0].map(c => c.x.m).sort((a, b) => (a.date || '').localeCompare(b.date || '')) });
      return false;
    });
    return { paires, dejaPointees, remises, absentes: seules, restants: libres.filter(x => !x.pris).map(x => x.m) };
  }

  // (1.266.0) La prévision semaine par semaine : ce qui rentre, ce qui sort, le solde au soir du dernier jour. Les semaines
  // vont du lundi au dimanche ; la première commence aujourd'hui, la dernière finit à l'horizon. Lue sur les mêmes
  // échéances que la courbe (`cashForecast`) : la somme des semaines est la prévision, au millime.
  function semainesTreso(f) {
    const out = [];
    let du = f.today, solde = f.start, i = 0;
    const ev = f.events || [];
    while (du <= f.horizon) {
      const jour = new Date(du + 'T00:00:00Z').getUTCDay();
      let au = addDays(du, (7 - jour) % 7);
      if (au > f.horizon) au = f.horizon;
      let entrees = 0, sorties = 0, n = 0;
      while (i < ev.length && ev[i].date <= au) {
        if (ev[i].amount > 0) entrees = round3(entrees + ev[i].amount); else sorties = round3(sorties + ev[i].amount);
        n++; i++;
      }
      solde = round3(solde + entrees + sorties);
      out.push({ du, au, entrees, sorties, solde, n });
      du = addDays(au, 1);
    }
    return out;
  }

  // Prévision : le solde d'aujourd'hui, puis ce qui doit rentrer et sortir, jour après jour.
  // On ne prévoit que ce qui a une échéance connue — pas de projection statistique, pas de devinette.
  // (1.266.0) `opts.prudent` : sans les factures clients déjà échues. Une facture en retard est attendue « tout de suite »
  // (la repousser serait se mentir) — mais compter dessus l'est aussi : la vue prudente dit ce que devient le solde si
  // elles ne rentrent pas, et donc combien l'entreprise dépend de ses retardataires.
  function cashForecast(data, company, days, todayIso, opts) {
    const t = todayIso || today();
    const o = opts || {};
    // (1.266.0) Comment attendre l'argent des clients : à l'échéance (le défaut, ce que la facture dit), « habitude » (au
    // délai réel de chaque client, mesuré sur ses factures soldées), ou « prudent » (sans les factures déjà échues).
    const mode = o.prudent ? 'prudent' : (o.encaissement === 'habitude' || o.encaissement === 'prudent' ? o.encaissement : 'echeance');
    const prudent = mode === 'prudent';
    const horizon = addDays(t, Math.max(1, Number(days) || 90));
    const start = cashPosition(data, company, t).total;
    const events = [];
    const delais = {};
    const delaiDe = id => (id in delais ? delais[id] : (delais[id] = delaiClient(data, company, id, t)));

    // Ce qui doit rentrer : le reste à payer de chaque facture ouverte, à son échéance.
    (data.documents || []).filter(d => d.type === 'facture' && d.status !== 'brouillon' && d.status !== 'annulée').forEach(d => {
      const rest = invoiceBalance(d, data, company).remaining;
      if (rest <= 0.0005) return;
      // Une facture déjà échue est attendue « tout de suite » : la repousser serait se mentir.
      let due = d.dueDate && d.dueDate > t ? d.dueDate : t;
      if (prudent && d.dueDate && d.dueDate < t) return;
      // Au délai habituel du client : l'échéance (ou la date de la pièce) plus son retard moyen, jamais avant aujourd'hui.
      const dl = mode === 'habitude' ? delaiDe(d.clientId) : null;
      if (dl && dl.jours > 0) { const at = addDays(d.dueDate || d.date || t, dl.jours); due = at > t ? at : t; }
      if (due > horizon) return;
      events.push({ date: due, amount: round3(toBase(d, rest, company)), kind: 'client', late: !!(d.dueDate && d.dueDate < t), habitude: dl && dl.jours > 0 ? dl.jours : 0,
        label: `${d.number || 'Facture'} — ${((data.clients || []).find(c => c.id === d.clientId) || {}).name || ''}`.trim(), id: d.id });
    });
    // Ce qui doit sortir : le reste dû de chaque achat — CONVERTI, comme la branche des clients juste
    // au-dessus. `purchaseBalance` rend le reste dans la devise de la pièce : une facture Adobe de
    // 1 190 € sortait de la prévision pour 1 190 DT au lieu de 4 046 — le trou annoncé était
    // sous-estimé de 2 856 dinars, sur la page faite pour savoir si l'on tiendra (rapport QA E-08,
    // le jumeau que la 10.1.0 n'avait pas vu parmi ses treize agrégateurs).
    (data.purchases || []).forEach(p => {
      const rest = purchaseBalance(p, company, data).remaining;
      if (rest <= 0.0005) return;
      const due = p.dueDate && p.dueDate > t ? p.dueDate : t;
      if (due > horizon) return;
      events.push({ date: due, amount: -round3(toBase(p, rest, company)), kind: 'fournisseur', late: !!(p.dueDate && p.dueDate < t),
        label: `${p.number || 'Achat'} — ${((data.suppliers || []).find(s => s.id === p.supplierId) || {}).name || ''}`.trim(), id: p.id });
    });
    // Ce qui doit sortir aussi : le net des bulletins pas encore payés (10.14.0). Un salaire dû est la
    // sortie la plus certaine qui soit — et la prévision l'ignorait : sur l'exemple, les 2 005 DT de
    // la paie d'août manquaient au « Solde projeté à 30 jours », sur la page faite pour savoir si
    // l'on tiendra. Le net est celui que le bulletin verse (avance déjà retenue), à la date de
    // paiement prévue si elle est à venir, sinon à la fin du mois du bulletin, ramenée à aujourd'hui
    // quand elle est passée — comme une facture échue.
    // Un bulletin marqué payé, lui, est un mouvement : dans le disponible s'il l'est à ce jour, dans
    // la branche des saisies à venir s'il l'est pour plus tard — jamais les deux.
    (data.payslips || []).forEach(sl => {
      if (sl.paidDate) return;
      const net = round3(((sl.computed || {}).net) || 0);
      if (net <= 0.0005) return;
      const fin = payslipDate(sl);
      const due = fin && fin > t ? fin : t;
      if (due > horizon) return;
      const emp = (data.employees || []).find(e => e.id === sl.employeeId) || {};
      events.push({ date: due, amount: -net, kind: 'salaire', late: !!fin && fin < t,
        label: `Salaire ${monthLabel(fin)} — ${emp.name || 'Salarié'}`, id: sl.id });
    });
    // Ce qui est déjà saisi pour plus tard (10.14.0) : un paiement client, un règlement, un bulletin
    // payé, une avance ou un mouvement daté après aujourd'hui. Il n'est pas dans le disponible, qui
    // s'arrête aujourd'hui, et une facture le compte déjà comme encaissé : sans cette branche, il
    // disparaissait de la prévision — un loyer saisi pour le 3 ne sortait nulle part.
    cashMovements(data, company, { from: addDays(t, 1), to: horizon }, null).forEach(m => {
      if (!m.amount) return;
      events.push({ date: m.date, amount: round3(m.amount), kind: 'saisi', source: m.source, late: false,
        label: m.party && m.party !== m.label ? `${m.label} — ${m.party}` : m.label,
        id: m.docId || m.purchaseId || m.payslipId || m.advanceId || m.movementId || m.id });
    });
    // Ce qui revient tout seul : les contrats récurrents déjà programmés.
    (data.recurring || []).filter(r => r.active !== false).forEach(r => {
      let d = r.nextDate;
      for (let i = 0; i < 24 && d && d <= horizon; i++) {
        if (d >= t) {
          const inv = buildRecurringInvoice(r, d, company, (data.clients || []).find(c => c.id === r.clientId));
          const due = addDays(d, delaiJours(company.paymentTermsDays, 30));
          // `toBase`, comme la branche des factures clients dix-neuf lignes plus haut : un contrat
          // porte sa devise et `buildRecurringInvoice` la reporte sur chaque facture. Sans la
          // conversion, un abonnement de 800 € entrait dans la prévision pour 800 DT — la courbe
          // montrait un creux qui n'existe pas, sur la page faite pour savoir si l'on tiendra.
          if (due <= horizon) events.push({ date: due, amount: round3(toBase(inv, computeTotals(inv, company).netToPay, company)), kind: 'contrat',
            label: fillTemplate(r.subject, { mois: monthLabel(d), annee: d.slice(0, 4) }), id: r.id });
        }
        d = nextRecurrenceDate(d, r.every, r.day);
      }
    });
    // (1.266.0) Les salaires des mois qui n'ont pas encore de bulletin : la prévision ne connaissait que les bulletins déjà
    // faits, et à 90 jours décembre et janvier sortaient sans paie. Chaque salarié en poste reçoit, à la fin de chaque mois
    // de l'horizon sans bulletin, le net que son contrat donne (`computePayslip` sans variable) — marqué « estimé ».
    // (1.266.7) Un mois à venir sans bulletin : chaque salarié en poste reçoit ce que sa fiche donne un mois plein, ses primes
    // comprises (`saisieDeLaFiche`, le calcul de la liste des salariés) — son net pour le salaire prévu, et ses retenues et
    // cotisations pour les impôts plus bas : un seul calcul pour les trois.
    const sPaie = payrollSettings(data);
    const fiches = {};
    const ficheDe = e => (e.id in fiches ? fiches[e.id] : (fiches[e.id] = (() => { try { return computePayslip(e, saisieDeLaFiche(e, sPaie), sPaie) || {}; } catch (_) { return {}; } })()));
    const aBulletin = new Set((data.payslips || []).map(sl => `${sl.employeeId}|${Number(sl.year)}-${Number(sl.month)}`));
    const sansBulletin = (y, m) => {
      const debut = `${y}-${pad2(m)}-01`, fin = addDays(debut, daysInMonth(y, m) - 1);
      if (fin < t) return [];
      return (data.employees || []).filter(e => !(e.active === false || (e.hireDate && e.hireDate > fin) || (e.endDate && e.endDate < debut)) && !aBulletin.has(`${e.id}|${y}-${m}`));
    };
    if (o.salaires !== false) {
      for (let k = 0; k < 8; k++) {
        const y0 = Number(t.slice(0, 4)), m0 = Number(t.slice(5, 7)) - 1 + k;
        const y = y0 + Math.floor(m0 / 12), m = (m0 % 12) + 1;
        const debut = `${y}-${pad2(m)}-01`, fin = addDays(debut, daysInMonth(y, m) - 1);
        if (fin < t) continue;
        if (debut > horizon || fin > horizon) break;
        sansBulletin(y, m).forEach(e => {
          const net = round3(ficheDe(e).net || 0);
          if (!(net > 0)) return;
          events.push({ date: fin, amount: -net, kind: 'salaire-prevu', estime: true, label: `Salaire ${monthLabel(fin)} — ${e.name || 'Salarié'}`, id: `${e.id}@${y}-${pad2(m)}` });
        });
      }
    }
    // (1.266.0) Les impôts dont on connaît la date ET dont on sait estimer le montant : la déclaration mensuelle (la TVA du
    // mois écoulé, les retenues opérées sur les achats et sur les salaires) et la CNSS du trimestre — sur ce qui est saisi à
    // ce jour, donc « estimé ». L'acompte provisionnel et le bilan gardent leur date seule : leur montant ne se devine pas.
    if (o.impots !== false) {
      const regles = fiscalDeadlines(data).filter(r => r.active !== false);
      const done = fiscalDone(data), sociales = socialesDeposees(data);
      const tva = regles.find(r => r.id === 'tva');
      if (tva) {
        let d = nextDeadline(tva, t), garde = 0;
        while (d && d <= horizon && garde++ < 12) {
          if (!done.has(fiscalFilingId('tva', d))) {
            const y = Number(d.slice(0, 4)), mm = Number(d.slice(5, 7)) - 1, yy = mm === 0 ? y - 1 : y, mois = mm === 0 ? 12 : mm;
            const from = `${yy}-${pad2(mois)}-01`, to = addDays(from, daysInMonth(yy, mois) - 1);
            const v = vatReturn(data, company, { from, to });
            // (1.266.7) La part paie payée à part (« Noter déposée et payée », `dm-AAAA-MM`) est déjà un mouvement : elle ne sort
            // pas une seconde fois. Sinon, celle des bulletins faits, plus l'estimation de ceux qui manquent.
            let sal = 0;
            if (!sociales.has(`dm-${yy}-${pad2(mois)}`)) {
              try { sal = round3((declarationMensuelleSalaires(data, yy, mois) || {}).total || 0); } catch (_) { sal = 0; }
              sal = round3(sansBulletin(yy, mois).reduce((a, e) => { const c = ficheDe(e); return round3(a + (c.irpp || 0) + (c.css || 0) + (c.tfp || 0) + (c.foprolos || 0)); }, sal));
            }
            const montant = round3((v.toPay || 0) + (v.withheldOnBuys || 0) + sal);
            if (montant > 0.0005) events.push({ date: d, amount: -montant, kind: 'fiscal', estime: true, label: `${tva.label} — ${MONTHS_FR[mois - 1]} ${yy}`, id: fiscalFilingId('tva', d),
              detail: { tva: round3(v.toPay || 0), retenues: round3(v.withheldOnBuys || 0), salaires: sal } });
          }
          d = nextDeadline(tva, addDays(d, 1));
        }
      }
      const cnss = regles.find(r => r.id === 'cnss');
      if (cnss) {
        let d = nextDeadline(cnss, t), garde = 0;
        while (d && d <= horizon && garde++ < 6) {
          const soc = echeanceSociale('cnss', d);
          if (soc && !sociales.has(soc.id) && !done.has(fiscalFilingId('cnss', d))) {
            const [, yy, q] = /cnss-(\d{4})-T(\d)/.exec(soc.id) || [];
            const c = yy ? cnssDeclaration(data, Number(yy), Number(q)) : null;
            // (1.266.7) Les mois du trimestre dont les bulletins ne sont pas encore faits : estimés sur les fiches.
            const total = c ? round3(c.months.reduce((a, mo) => sansBulletin(Number(yy), mo).reduce((b, e) => { const x = ficheDe(e); return round3(b + (x.cnssEmployee || 0) + (x.cnssEmployer || 0) + (x.accident || 0)); }, a), c.total)) : 0;
            if (c && total > 0.0005) events.push({ date: d, amount: -total, kind: 'fiscal', estime: true, label: `${cnss.label} — ${c.label} ${yy}`, id: soc.id });
          }
          d = nextDeadline(cnss, addDays(d, 1));
        }
      }
    }
    // (1.266.0) Les dépenses qui reviennent sans facture — le loyer, la STEG, l'abonnement internet, le leasing : un mouvement
    // libre marqué « se répète » se projette à chaque période, jusqu'à sa date de fin. Une occurrence déjà notée
    // (`repeteDe` + `occurrence`) ne se projette plus : elle est dans les mouvements.
    const PAS_REPETE = { mois: 1, trimestre: 3, annee: 12 };
    const notees = new Set((data.movements || []).filter(m => m.repeteDe).map(m => `${m.repeteDe}@${m.occurrence}`));
    // (1.298.0, revue de la Trésorerie) Une occurrence se reconnaît notée aussi quand elle a été saisie à la main, sans
    // « Noter comme payé » : un mouvement simple du même compte, de même nature et de même montant, à sept jours près (pris
    // une seule fois). Sans quoi le loyer noté à la main se comptait deux fois dans la prévision.
    const simples = (data.movements || []).filter(x => !x.repete && !x.repeteDe && x.date);
    const prisAMain = new Set();
    const noteeAMain = (m, d) => {
      const montant = round3(Math.abs(Number(m.amount) || 0));
      const c = simples.find(x => !prisAMain.has(x.id) && x.id !== m.id && x.accountId === m.accountId && x.kind === m.kind
        && Math.abs(round3(Math.abs(Number(x.amount) || 0) - montant)) < 0.0005 && Math.abs(daysBetween(x.date, d)) <= 7);
      if (c) prisAMain.add(c.id);
      return !!c;
    };
    // (1.298.0) Une occurrence PASSÉE que personne n'a notée (le loyer du 5, lu le 6) : la prévision la croyait payée et
    // ne la montrait nulle part — 1 200 DT de trop dans la caisse, sans une question (vu le 06/11/2026). Elle se compte
    // aujourd'hui, « déjà échue », comme un achat en retard, et l'écran demande si elle est payée. Seulement les trois
    // derniers mois : plus loin, c'est le rapprochement du relevé qui le dira.
    const depuisRetard = addDays(t, -92);
    (data.movements || []).filter(m => PAS_REPETE[m.repete] && m.date && !(virementCotes(data, m) || {}).vers).forEach(m => {
      const pas = PAS_REPETE[m.repete];
      const j = Number(m.date.slice(8, 10));
      for (let k = 1; k <= 60; k++) {
        const y0 = Number(m.date.slice(0, 4)), m0 = Number(m.date.slice(5, 7)) - 1 + k * pas;
        const y = y0 + Math.floor(m0 / 12), mo = (m0 % 12) + 1;
        const d = `${y}-${pad2(mo)}-${pad2(Math.min(j, daysInMonth(y, mo)))}`;
        if (d > horizon || (m.repeteJusqu && d > m.repeteJusqu)) break;
        if (d <= t && d < depuisRetard) continue;
        if (notees.has(`${m.id}@${d}`) || noteeAMain(m, d)) continue;
        const montant = round3(Math.abs(Number(m.amount) || 0));
        if (!montant) continue;
        const passee = d < t;
        events.push({ date: passee ? t : d, amount: round3(moveSign(m.kind) * montant), kind: 'repete', late: passee, occurrence: d,
          label: m.label || (MOVE_KINDS.find(x => x[0] === m.kind) || [null, 'Mouvement'])[1], id: `${m.id}@${d}`, movementId: m.id });
      }
    });
    // Les échéances fiscales : la date de toutes, pour la liste ; les montants estimés sont dans la courbe ci-dessus.
    const fiscal = upcomingFiscal(data, t, Math.max(1, Number(days) || 90));
    // (1.266.0) L'essai « et si je décale ? » : une échéance déplacée à une autre date, rien n'est enregistré.
    const dec = o.decalages || {};
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i], cle = `${e.kind}:${e.id}`;
      if (!dec[cle]) continue;
      if (dec[cle] > horizon) events.splice(i, 1); else { e.date = dec[cle] < t ? t : dec[cle]; e.decale = true; }
    }

    events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    // Courbe jour par jour, uniquement aux dates où il se passe quelque chose (plus lisible qu'un point par jour).
    const points = [{ date: t, balance: start, label: 'aujourd\'hui', delta: 0 }];
    let running = start, lowest = { date: t, balance: start };
    events.forEach(e => {
      running = round3(running + e.amount);
      points.push({ date: e.date, balance: running, label: e.label, delta: e.amount, kind: e.kind });
      if (running < lowest.balance) lowest = { date: e.date, balance: running, label: e.label };
    });
    const inflow = round3(events.filter(e => e.amount > 0).reduce((s, e) => s + e.amount, 0));
    const outflow = round3(events.filter(e => e.amount < 0).reduce((s, e) => s + e.amount, 0));
    // (1.266.0) Le seuil sous lequel il ne faut pas descendre : zéro par défaut, ou le minimum que l'entreprise se fixe (un
    // découvert autorisé se règle en négatif : « −5 000 »). Un seuil illisible ne fait rien — il vaut zéro.
    const seuil = Number.isFinite(Number(company && company.tresoSeuil)) ? round3(Number(company.tresoSeuil)) : 0;
    let sous = null;
    for (const p of points) if (p.balance < seuil - 0.0005) { sous = { date: p.date, balance: p.balance, label: p.label }; break; }
    return {
      today: t, horizon, start, events, points, inflow, outflow, end: running, lowest, fiscal, seuil, mode,
      estimes: round3(events.filter(e => e.estime).reduce((x, e) => x + e.amount, 0)),
      // Le seul chiffre qui compte vraiment : à quelle date, si rien ne change, on passe sous le seuil. Le PREMIER passage
      // (la date où il faut agir), avec le point le plus bas à côté (`lowest`).
      shortfall: sous ? { ...sous, lowest } : null,
      // (1.298.0) Ce qui est déjà dû se range par ce que c'est : « déjà dus à tes fournisseurs » comptait aussi les
      // salaires en retard (et aurait compté le loyer pas noté) sous « achats échus ».
      late: { clients: events.filter(e => e.late && e.amount > 0), suppliers: events.filter(e => e.late && e.amount < 0 && e.kind === 'fournisseur'),
        salaires: events.filter(e => e.late && e.amount < 0 && e.kind === 'salaire'), repetes: events.filter(e => e.late && e.amount < 0 && e.kind === 'repete') }
    };
  }

  // Rapprochement : ce que dit ton relevé face à ce que dit SkanFact.
  function reconciliation(data, company, accountId, toIso) {
    const acc = (data.accounts || []).find(a => a.id === accountId);
    if (!acc) return null;
    const b = accountBalance(data, company, accountId, toIso);
    const moves = cashMovements(data, company, { from: acc.openingDate || '', to: toIso || '9999-12-31' }, accountId);
    const pending = moves.filter(m => !m.reconciled);
    const statement = Number(acc.statementBalance);
    const known = Number.isFinite(statement) && acc.statementBalance !== '' && acc.statementBalance != null;
    // Solde pointé = départ + mouvements pointés. C'est lui qui doit tomber sur le relevé.
    const pointed = round3(b.opening + moves.filter(m => m.reconciled).reduce((s, m) => s + m.amount, 0));
    return {
      account: acc, opening: b.opening, balance: b.balance, pointed,
      pendingCount: pending.length, pendingAmount: round3(pending.reduce((s, m) => s + m.amount, 0)),
      statement: known ? round3(statement) : null,
      gap: known ? round3(pointed - statement) : null, moves
    };
  }

  // ---------- travailler à deux sur les mêmes données (3.2.0) ----------
  // Deux postes partagent un dossier (iCloud, OneDrive, clé USB, disque réseau). Chacun écrit le
  // fichier à son tour. Le danger n'est pas la panne : c'est le silence. Sans garde-fou, le dernier
  // qui enregistre écrase le travail de l'autre sans que personne ne le sache jamais.
  //
  // Le principe retenu : on ne fusionne JAMAIS deux versions d'une même pièce en une troisième.
  // On garde celle du fichier écrit le plus récemment, on signale le désaccord, et on archive
  // l'autre version pour qu'elle reste consultable. Rien n'est détruit sans trace.

  // Les listes du fichier qui se fusionnent pièce par pièce, grâce à leur identifiant.
  const MERGE_LISTS = ['clients', 'catalog', 'documents', 'recurring', 'templates', 'snippets', 'suppliers', 'purchases', 'accounts', 'movements', 'projects', 'assets', 'stockAdjustments', 'serials', 'employees', 'payslips', 'leaves', 'advances', 'socialFilings', 'fiscalFilings', 'packs', 'licences', 'ecrituresOD'];
  const LIST_LABELS = {
    clients: 'client', catalog: 'prestation', documents: 'document', recurring: 'contrat récurrent',
    templates: 'modèle', snippets: 'texte', suppliers: 'fournisseur', purchases: 'achat',
    accounts: 'compte', movements: 'mouvement', projects: 'affaire', assets: 'immobilisation', stockAdjustments: 'mouvement de stock', serials: 'numéro de série', employees: 'salarié', payslips: 'bulletin de paie', leaves: 'congé', advances: 'avance sur salaire', socialFilings: 'déclaration sociale', fiscalFilings: 'échéance fiscale déposée', packs: 'envoi au cabinet', licences: 'licence émise', ecrituresOD: 'opération diverse'
  };
  // Le pluriel de chaque étiquette, écrit EN ENTIER (E-13) : « 2 bulletins de paie », pas « 2 bulletin
  // de paie » ni « 2 bulletin de paies ». Ajouter un « s » au bout n'accorde que le dernier mot, et
  // ne rien ajouter n'en accorde aucun. Les deux tables portent les MÊMES clés : un test les confronte.
  const LIST_PLURIELS = {
    clients: 'clients', catalog: 'prestations', documents: 'documents', recurring: 'contrats récurrents',
    templates: 'modèles', snippets: 'textes', suppliers: 'fournisseurs', purchases: 'achats',
    accounts: 'comptes', movements: 'mouvements', projects: 'affaires', assets: 'immobilisations', stockAdjustments: 'mouvements de stock', serials: 'numéros de série', employees: 'salariés', payslips: 'bulletins de paie', leaves: 'congés', advances: 'avances sur salaire', socialFilings: 'déclarations sociales', fiscalFilings: 'échéances fiscales déposées', packs: 'envois au cabinet', licences: 'licences émises', ecrituresOD: 'opérations diverses'
  };
  // « 5 prestations », « 1 bulletin de paie » : le compte d'une liste, accordé.
  const compteListe = (k, n) => plFr(n, LIST_LABELS[k] || k, LIST_PLURIELS[k]);

  // (1.316.0) Le même contenu, quel que soit l'ordre de ses champs : le serveur (PostgreSQL) rend une fiche dans son ordre à
  // lui, la page dans le sien ; comparées en texte, trois fiches d'articles que personne n'avait touchées se disaient
  // « modifiées des deux côtés » au rechargement suivant (« Modifications des deux côtés », trois articles).
  const enOrdre = v => Array.isArray(v) ? v.map(enOrdre) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => { o[k] = enOrdre(v[k]); return o; }, {}) : v;
  function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b) || JSON.stringify(enOrdre(a)) === JSON.stringify(enOrdre(b)); }

  // Étiquette lisible d'une pièce, pour dire à l'utilisateur ce qui a bougé.
  function recordLabel(kind, rec) {
    if (!rec) return '';
    if (kind === 'documents') return `${TITLES[rec.type] || 'Document'} ${rec.number || '(brouillon)'}`;
    if (kind === 'purchases') return `Achat ${rec.number || 'sans numéro'}`;
    return rec.name || rec.label || rec.subject || rec.id || '';
  }

  // Fusion de deux versions du même dossier. `mine` = ce qu'on a en mémoire, `theirs` = ce qui est
  // sur le disque partagé. Aucune des deux n'est modifiée.
  // (16 § 10.1, urgence 2, 03/11/2026 ; à sortir avec le module Personnel) LE POINTAGE SE FUSIONNE CASE PAR CASE. Il n'était
  // pas dans la fusion : dès qu'un enregistrement était refusé pour un conflit (même sur un client changé par un collègue),
  // le poste reprenait le pointage du serveur et perdait le sien sans un mot. `anc` : ce que les deux versions avaient en
  // commun (le dossier tel que ce poste l'avait eu du serveur) ; une case qui y est et que l'un a retirée est effacée, une
  // case qui n'y est pas a été posée. Sans `anc`, ce qui est posé l'emporte sur ce qui manque. Deux valeurs différentes
  // sur la même case : celle du gagnant reste, l'autre est mise de côté et dite, comme une pièce.
  const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, c) => { o[c] = x[c]; return o; }, {}) : x));
  const memeValeur = (x, y) => canon(x) === canon(y);
  const plat = v => !!v && typeof v === 'object' && !Array.isArray(v);
  // Une table (clé → valeur) à trois versions : l'ancêtre, le gagnant, l'autre ; `desaccord` tranche une clé changée des deux côtés.
  function fusion3(anc, gagnant, autre, desaccord) {
    const out = {};
    new Set([...Object.keys(anc || {}), ...Object.keys(gagnant || {}), ...Object.keys(autre || {})]).forEach(k => {
      const x = (anc || {})[k], y = (gagnant || {})[k], z = (autre || {})[k];
      const v = memeValeur(y, z) || memeValeur(x, z) ? y : memeValeur(x, y) ? z : desaccord(k, y, z);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }
  function fusionnerPointage(anc, winner, loser, out, conflicts, archive, kept) {
    const A = anc || {};
    const dire = (id, label, record) => { conflicts.push({ kind: 'pointage', id, label, kept }); archive.push({ at: new Date().toISOString(), kind: 'pointage', id, label, record }); };
    const a2 = n => String(n).padStart(2, '0');
    // Un objet par salarié et par mois ; deux postes ont pu en créer chacun un : ils se replient (le premier lu l'emporte).
    const replier = (p, t) => { const o = { ...t, ...p }; Object.keys(t).forEach(c => { if (plat(t[c]) && plat(p[c])) o[c] = { ...t[c], ...p[c] }; }); return o; };
    const parMois = L => { const m = new Map(); (Array.isArray(L) ? L : []).forEach(t => { if (!t) return; const k = t.employeeId ? `${t.employeeId}|${Number(t.year)}|${Number(t.month)}` : `?${t.id}`; m.set(k, m.has(k) ? replier(m.get(k), t) : t); }); return m; };
    // Le total des heures sup du mois = la part notée au mois + les heures des journées (`hsJours`) : chaque part se fusionne,
    // puis le total se refait (sinon deux journées notées sur deux postes n'en payaient qu'une).
    const parJours = hj => { const s = {}; Object.values(hj || {}).forEach(x => { if (x && Number(x.heures) > 0) { const k = String(Number(x.majoration)); s[k] = round3((s[k] || 0) + Number(x.heures)); } }); return s; };
    const auMois = o => { const s = parJours(o.hsJours), r = {}; new Set([...Object.keys(o.hs || {}), ...Object.keys(s)]).forEach(k => { const v = round3((Number((o.hs || {})[k]) || 0) - (s[k] || 0)); if (v) r[k] = v; }); return r; };
    if (Array.isArray(winner.timesheets) || Array.isArray(loser.timesheets)) {
      const sa = parMois(A.timesheets), sw = parMois(winner.timesheets), sl = parMois(loser.timesheets);
      const noms = new Map((out.employees || []).map(e => [e.id, e.name || '']));
      const ts = [];
      new Set([...sw.keys(), ...sl.keys()]).forEach(k => {
        const a = sa.get(k), w = sw.get(k), l = sl.get(k);
        // Retiré d'un côté, intact de l'autre (« Annuler » du premier geste du mois) : il part.
        if ((!w && memeValeur(a, l)) || (!l && memeValeur(a, w))) return;
        if (w && memeValeur(w, l)) { ts.push(w); return; }
        const W = w || {}, Lo = l || {}, Aa = a || {}, t = { ...Lo, ...W }, nom = noms.get(t.employeeId) || '';
        Object.keys(t).filter(c => c !== 'hs' && (plat(W[c]) || plat(Lo[c]))).forEach(c => {
          t[c] = fusion3(Aa[c], W[c], Lo[c], (j, y, z) => {
            // Des passages de la pointeuse : des faits, on les garde tous.
            if (c === 'badges' && plat(y) && plat(z)) return { ...z, ...y, h: [...new Set([...(y.h || []), ...(z.h || [])])].sort() };
            dire(t.id, `${nom}, le ${a2(j)}/${a2(t.month)}/${t.year}`, { champ: c, jour: j, valeur: z === undefined ? null : z });
            return y;
          });
        });
        const part = fusion3(auMois(Aa), auMois(W), auMois(Lo), (mj, y, z) => { dire(t.id, `${nom}, heures sup du mois à +${mj} % (${a2(t.month)}/${t.year})`, { champ: 'hs', majoration: mj, valeur: z === undefined ? null : z }); return y; });
        const parJ = parJours(t.hsJours), hs = {};
        new Set([...Object.keys(part), ...Object.keys(parJ)]).forEach(mj => { const v = round3((part[mj] || 0) + (parJ[mj] || 0)); if (v > 0) hs[mj] = v; });
        t.hs = hs;
        ts.push(t);
      });
      out.timesheets = ts;
    }
    // Les journées validées, une par jour (`iso`) : changées des deux côtés, le geste le plus récent l'emporte.
    if (Array.isArray(winner.joursValides) || Array.isArray(loser.joursValides)) {
      const parIso = L => Object.fromEntries((Array.isArray(L) ? L : []).filter(x => x && x.iso).map(x => [x.iso, x]));
      const dernier = x => String((x && (x.rouvertLe || x.le)) || '');
      out.joursValides = Object.values(fusion3(parIso(A.joursValides), parIso(winner.joursValides), parIso(loser.joursValides), (k, y, z) => (dernier(z) > dernier(y) ? z : y)))
        .sort((x, y) => x.iso.localeCompare(y.iso));
    }
    // Les versions validées d'un mois et les imports de la pointeuse : des faits datés, gardés tous, dans l'ordre où ils sont nés.
    ['pointageVersions', 'badgeImports'].forEach(c => {
      if (!Array.isArray(winner[c]) && !Array.isArray(loser[c])) return;
      const parId = L => Object.fromEntries((Array.isArray(L) ? L : []).filter(x => x && x.id).map(x => [x.id, x]));
      out[c] = Object.values(fusion3(parId(A[c]), parId(winner[c]), parId(loser[c]), (k, y) => y)).sort((x, y) => String(x.le || '').localeCompare(String(y.le || '')));
    });
    // Les mois rouverts (« Corriger : une nouvelle version ») : un ensemble.
    if (Array.isArray(winner.pointageOuverts) || Array.isArray(loser.pointageOuverts)) {
      const parYm = L => Object.fromEntries((Array.isArray(L) ? L : []).map(x => [String(x), true]));
      out.pointageOuverts = Object.keys(fusion3(parYm(A.pointageOuverts), parYm(winner.pointageOuverts), parYm(loser.pointageOuverts), () => true)).sort();
    }
  }

  function mergeData(mine, theirs, anc) {
    const a = migrateData(mine), b = migrateData(theirs);
    // Quel fichier a été écrit en dernier : c'est lui qui tranche en cas de désaccord sur une pièce.
    const aTime = Number(a.syncWrittenAt) || 0, bTime = Number(b.syncWrittenAt) || 0;
    const theirsWins = bTime > aTime;
    const out = JSON.parse(JSON.stringify(theirsWins ? b : a));
    const winner = theirsWins ? b : a, loser = theirsWins ? a : b;
    const conflicts = [], added = [], archive = (out.conflictArchive || []).slice();

    // Suppressions : sans trace, une pièce supprimée ici réapparaîtrait à la fusion, venue de l'autre poste.
    const tombstones = {};
    [].concat(a.deleted || [], b.deleted || []).forEach(t => { if (t && t.id) tombstones[t.id] = t; });
    out.deleted = Object.values(tombstones).sort((x, y) => (x.at || '').localeCompare(y.at || ''));

    MERGE_LISTS.forEach(kind => {
      const byId = {};
      (winner[kind] || []).forEach(r => { if (r && r.id) byId[r.id] = { rec: r, from: 'winner' }; });
      (loser[kind] || []).forEach(r => {
        if (!r || !r.id) return;
        const cur = byId[r.id];
        if (!cur) { byId[r.id] = { rec: r, from: 'loser' }; added.push({ kind, label: recordLabel(kind, r) }); return; }
        if (sameJson(cur.rec, r)) return;
        // Les deux postes ont touché la même pièce : on garde celle du fichier le plus récent,
        // on le dit, et on met l'autre de côté au lieu de la jeter.
        conflicts.push({ kind, id: r.id, label: recordLabel(kind, r), kept: theirsWins ? 'autre poste' : 'ce poste' });
        archive.push({ at: new Date().toISOString(), kind, id: r.id, label: recordLabel(kind, r), record: r });
      });
      out[kind] = Object.values(byId).map(x => x.rec).filter(r => !tombstones[r.id]);
    });
    fusionnerPointage(anc, winner, loser, out, conflicts, archive, theirsWins ? 'autre poste' : 'ce poste');

    // Compteurs de numérotation : on prend toujours le plus haut. Un numéro déjà attribué quelque part
    // ne doit jamais être réutilisé, même si l'autre poste ne l'a pas encore vu.
    out.counters = { ...(loser.counters || {}) };
    Object.keys(winner.counters || {}).forEach(k => {
      out.counters[k] = Math.max(Number(out.counters[k]) || 0, Number(winner.counters[k]) || 0);
    });

    // Fiche société : elle ne se fusionne pas champ par champ. Celle du fichier le plus récent gagne.
    if (!sameJson(a.company, b.company)) conflicts.push({ kind: 'company', id: 'company', label: 'Fiche société', kept: theirsWins ? 'autre poste' : 'ce poste' });

    // Deux personnes hors ligne peuvent avoir émis la même facture sous le même numéro. C'est le seul
    // désaccord que SkanFact ne peut pas trancher : il se signale fort, il se corrige à la main.
    const seen = {}, duplicates = [];
    (out.documents || []).forEach(d => {
      if (!d.number || d.status === 'brouillon') return;
      const k = `${d.type}|${d.number}`;
      if (seen[k] && seen[k] !== d.id) duplicates.push({ type: d.type, number: d.number, label: `${TITLES[d.type] || 'Document'} ${d.number}` });
      else seen[k] = d.id;
    });

    out.conflictArchive = archive.slice(-200);   // on ne garde pas l'historique des conflits à l'infini
    return {
      data: out, conflicts, duplicates, added,
      keptFrom: theirsWins ? 'autre poste' : 'ce poste',
      counts: { conflicts: conflicts.length, duplicates: duplicates.length, added: added.length }
    };
  }

  // Enregistre la suppression d'une pièce, pour qu'elle ne revienne pas à la fusion suivante.
  function trackDeletion(data, kind, id, label) {
    if (!data || !id) return data;
    if (!Array.isArray(data.deleted)) data.deleted = [];
    if (!data.deleted.some(t => t.id === id)) data.deleted.push({ id, kind, label: label || '', at: new Date().toISOString() });
    if (data.deleted.length > 2000) data.deleted = data.deleted.slice(-2000);
    return data;
  }

  // ---------- TVA réelle et calendrier fiscal (3.1.0) ----------
  // Tout ce bloc relève du « À VÉRIFIER avec ton comptable » : ce sont des calculs arithmétiques
  // exacts sur tes données, pas une déclaration officielle. Les dates, la périodicité et le régime
  // applicable dépendent de ta situation.

  // Déclaration de TVA d'une période : collectée (ventes) moins déductible (achats), par taux.
  // `carryIn` est le crédit de TVA reporté du mois précédent, s'il y en a un.
  function vatReturn(data, company, period, carryIn) {
    const sales = salesJournal(data, company, period);
    const buys = purchaseJournal(data, company, period);
    const byRate = {};
    VAT_RATES.forEach(r => { byRate[r] = { collected: 0, deductible: 0 }; });
    sales.forEach(row => VAT_RATES.forEach(r => { byRate[r].collected = round3(byRate[r].collected + (row.vatByRate[r] ? row.vatByRate[r].vat : 0)); }));
    (data.purchases || []).filter(p => inPeriod(p.date, period && period.from, period && period.to)).forEach(p => {
      const t = purchaseTotals(p, company);
      const dejaDeduite = acomptesDeduits(data, p, company).byRate;
      // Un acompte à un autre taux que la facture se retranche aussi : l'union des deux listes.
      [...new Set([...Object.keys(t.vatByRate), ...Object.keys(dejaDeduite)])].forEach(rate => {
        if (!byRate[rate]) byRate[rate] = { collected: 0, deductible: 0 };
        byRate[rate].deductible = round3(byRate[rate].deductible + ((t.base.vatByRate[rate] || {}).deductible || 0) - (dejaDeduite[rate] || 0));
      });
    });
    const collected = round3(sales.reduce((s, r) => s + r.tva, 0));
    const deductible = round3(buys.reduce((s, r) => s + r.deductible, 0));
    const carry = round3(Math.max(0, Number(carryIn) || 0));
    const balance = round3(collected - deductible - carry);
    // Timbres encaissés : ils ne sont pas de la TVA mais se déclarent aussi. À VÉRIFIER.
    const stamps = round3(sales.reduce((s, r) => s + r.timbre, 0));
    // Retenues subies (déductibles de ton impôt) et opérées (à reverser) : celles des RÈGLEMENTS du
    // mois, jamais celles des factures (10.14.0) — tant que rien n'est versé, rien n'est retenu. Un
    // avoir posé après un règlement régularise dans SON mois.
    const withheldBySale = retenuesDeLaPeriode(data, company, period, 'ventes').total;
    const withheldOnBuys = retenuesDeLaPeriode(data, company, period, 'achats').total;
    return {
      period, byRate, collected, deductible, carryIn: carry,
      toPay: balance > 0 ? balance : 0,
      carryOut: balance < 0 ? round3(-balance) : 0,     // crédit de TVA reportable sur la période suivante
      stamps, withheldBySale, withheldOnBuys,
      salesCount: sales.length, buysCount: buys.length,
      salesHT: round3(sales.reduce((s, r) => s + r.ht, 0)),
      buysHT: round3(buys.reduce((s, r) => s + r.ht, 0))
    };
  }

  // Enchaînement des déclarations sur plusieurs mois : le crédit d'un mois se reporte sur le suivant.
  // C'est la seule façon d'obtenir un chiffre juste — une déclaration isolée ignore le report.
  // Le crédit de TVA avec lequel une année COMMENCE (10.14.0). La chaîne repartait de zéro chaque
  // 1er janvier, sauf crédit « saisi à la main » : un crédit laissé en décembre était PERDU en
  // janvier — la déclaration réclamait la TVA entière pendant que le 4366 gardait le crédit pour
  // toujours (316,160 DT sur l'exemple, cinq ans de suite), et le Cabinet, qui lit le 4366, disait
  // l'inverse de l'app entreprise pour le même mois. Le crédit se reporte d'une année à l'autre
  // comme d'un mois à l'autre : calculé dès que SkanFact connaît l'année d'avant, saisi à la main
  // pour la première année qu'il connaît (le crédit d'avant SkanFact).
  function premiereAnneeTva(data) {
    return duLot(data, 'tva:premiere', () => {
      let min = '';
      const noter = d => { const y = String(d || '').slice(0, 4); if (/^\d{4}$/.test(y) && (!min || y < min)) min = y; };
      (data.documents || []).forEach(d => { if ((d.type === 'facture' || d.type === 'avoir') && d.status !== 'brouillon') noter(d.date); });
      (data.purchases || []).forEach(p => noter(p.date));
      return min;
    });
  }
  function reportTvaDebut(data, company, year) {
    const y = String(year);
    const saisi = round3(Math.max(0, Number((data.vatCarryIn || {})[y]) || 0));
    const premiere = premiereAnneeTva(data);
    if (!premiere || y <= premiere) return { montant: saisi, source: 'saisi', saisi };
    const precedente = String(Number(y) - 1);
    const montant = duLot(data, 'tva:report:' + y, () => vatChain(data, company, precedente, 12)[11].carryOut);
    return { montant, source: 'calcule', saisi, depuis: precedente };
  }

  // Dans un LOT (10.14.1, AN-01), la chaîne d'une année se calcule UNE fois, sur ses douze mois, et
  // chaque appel en reçoit une COPIE coupée au mois demandé : le mois M ne dépend que des mois
  // d'avant, donc la chaîne jusqu'à M est le début de la chaîne entière. Sans ça, l'écriture des
  // à-nouveaux rappelait la chaîne de chaque année passée, et `reportTvaDebut` celle de l'année
  // d'avant, encore et encore : une entreprise de dix ans attendait quatre secondes par écran.
  function vatChain(data, company, year, upToMonth) {
    const last = Math.min(12, Math.max(1, Number(upToMonth) || 12));
    if (lot && data && typeof data === 'object') {
      const pleine = duLot(data, 'tva:chaine:' + year, () => vatChainCalcul(data, company, year, 12));
      return JSON.parse(JSON.stringify(pleine.slice(0, last)));
    }
    return vatChainCalcul(data, company, year, last);
  }
  function vatChainCalcul(data, company, year, last) {
    const out = [];
    let carry = reportTvaDebut(data, company, year).montant;
    for (let m = 1; m <= last; m++) {
      const from = `${year}-${pad2(m)}-01`;
      const to = `${year}-${pad2(m)}-${pad2(new Date(Date.UTC(Number(year), m, 0)).getUTCDate())}`;
      const r = vatReturn(data, company, { from, to }, carry);
      r.month = `${year}-${pad2(m)}`;
      r.label = MONTHS_FR[m - 1];
      out.push(r);
      carry = r.carryOut;
    }
    return out;
  }

  // (1.301.0) Les déclarations mensuelles du cabinet, mois par mois, face aux chiffres de l'entreprise. Un cabinet à qui l'on
  // confie les déclarations les dépose depuis ses livres (le serveur) : la Comptabilité de l'entreprise les lit, au lieu de
  // les lui faire pointer à la main. Pour chaque mois terminé de l'année qui a une activité ou une déclaration : sa date
  // limite (la règle « tva » du calendrier, au mois suivant), déposée (le, la référence) ou non, en retard ou non, et l'ÉCART
  // entre ce que le cabinet a déclaré et ce que les pièces disent aujourd'hui — une pièce du mois arrivée après le dépôt.
  // Une case que le cabinet n'a pas remplie ne fait pas d'écart (la règle inconnue ne fait rien). Le plus récent d'abord.
  function declarationsDuCabinet(data, company, annee, declarations, todayIso) {
    const t = todayIso || today();
    const y = Number(annee);
    const regle = fiscalDeadlines(data).find(r => r.id === 'tva') || { day: 28 };
    const parPeriode = new Map((declarations || []).filter(d => d && d.type === 'mensuelle').map(d => [String(d.periode), d]));
    const lu = v => (v === null || v === undefined || v === '' ? null : Number(String(v).replace(',', '.')));
    const out = [];
    vatChain(data, company, String(y), 12).forEach((m, i) => {
      const periode = `${y}-${pad2(i + 1)}`;
      if (`${periode}-${pad2(daysInMonth(y, i + 1))}` >= t) return;   // un mois pas terminé ne se déclare pas encore
      const d = parPeriode.get(periode) || null;
      if (!d && !m.collected && !m.deductible) return;
      const [ly, lm] = i === 11 ? [y + 1, 1] : [y, i + 2];
      const limite = `${ly}-${pad2(lm)}-${pad2(Math.min(Number(regle.day) || 28, daysInMonth(ly, lm)))}`;
      const deposee = d && d.deposee && d.deposee.le ? { le: String(d.deposee.le).slice(0, 10), reference: d.deposee.reference || '' } : null;
      const ecarts = [];
      if (deposee) {
        [['tvaCollectee', 'collectée', m.collected], ['tvaDeductible', 'déductible', m.deductible]].forEach(([cle, nom, maintenant]) => {
          const declare = lu(d.cases && d.cases[cle]);
          if (declare === null || !Number.isFinite(declare)) return;
          const ecart = round3(maintenant - declare);
          if (Math.abs(ecart) > 0.0005) ecarts.push({ cle, nom, declare: round3(declare), maintenant: round3(maintenant), ecart });
        });
      }
      out.push({ periode, label: `${MONTHS_FR[i]} ${y}`, limite, deposee, preparee: !!d, retard: !deposee && limite < t, ecarts, collectee: m.collected, deductible: m.deductible });
    });
    return out.reverse();
  }

  // Échéances fiscales récurrentes. Les dates et la périodicité dépendent du régime et de la forme
  // juridique : tout est paramétrable, rien n'est imposé. À VÉRIFIER avec le comptable.
  const DEFAULT_FISCAL_DEADLINES = [
    { id: 'tva', label: 'Déclaration mensuelle d\'employeur et de TVA', every: 'month', day: 28,
      note: 'Déclaration et paiement de la TVA du mois précédent, avec les retenues à la source opérées. Le jour limite dépend de ta forme juridique (personne physique ou morale).', active: true },
    { id: 'acompte', label: 'Acompte provisionnel', every: 'months', months: [6, 9, 12], day: 28,
      note: 'Trois acomptes sur l\'impôt de l\'année, calculés sur l\'impôt de l\'année précédente.', active: true },
    { id: 'tcl', label: 'Taxe sur les établissements (TCL)', every: 'month', day: 28,
      note: 'Généralement déclarée en même temps que la TVA, sur le chiffre d\'affaires local.', active: false },
    { id: 'employeur', label: 'Déclaration annuelle d\'employeur', every: 'year', month: 4, day: 30,
      note: 'Récapitulatif annuel des salaires versés et des retenues opérées.', active: true },
    { id: 'bilan', label: 'Déclaration annuelle de résultat', every: 'year', month: 6, day: 25,
      note: 'Dépôt du bilan et de la déclaration d\'impôt sur les sociétés ou sur le revenu.', active: true },
    { id: 'cnss', label: 'Déclaration CNSS trimestrielle', every: 'months', months: [1, 4, 7, 10], day: 15,
      note: 'Cotisations sociales du trimestre écoulé. Ne concerne que les entreprises avec des salariés.', active: false }
  ];

  function fiscalDeadlines(data) {
    const custom = (data && Array.isArray(data.fiscalDeadlines)) ? data.fiscalDeadlines : [];
    const byId = {};
    // Les échéances sociales ne concernent que les employeurs : elles s'allument d'elles-mêmes dès
    // qu'un salarié existe, et restent éteintes sinon (5.2.0). L'utilisateur peut toujours trancher.
    const hasStaff = !!(data && (data.employees || []).length);
    DEFAULT_FISCAL_DEADLINES.forEach(d => {
      byId[d.id] = { ...d, active: (d.id === 'cnss' && hasStaff) ? true : d.active };
    });
    custom.forEach(d => { if (d && d.id) byId[d.id] = { ...(byId[d.id] || {}), ...d }; });
    return Object.values(byId);
  }

  // Prochaine occurrence d'une échéance, à partir d'aujourd'hui.
  function nextDeadline(rule, todayIso) {
    const t = todayIso || today();
    const y0 = Number(t.slice(0, 4)), m0 = Number(t.slice(5, 7));
    const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
    const make = (y, m) => `${y}-${pad2(m)}-${pad2(Math.min(Number(rule.day) || 28, lastDay(y, m)))}`;
    const candidates = [];
    for (let k = 0; k <= 13; k++) {
      const m = ((m0 - 1 + k) % 12) + 1;
      const y = y0 + Math.floor((m0 - 1 + k) / 12);
      if (rule.every === 'month') candidates.push(make(y, m));
      else if (rule.every === 'months' && (rule.months || []).includes(m)) candidates.push(make(y, m));
      else if (rule.every === 'year' && m === (Number(rule.month) || 1)) candidates.push(make(y, m));
    }
    return candidates.filter(d => d >= t).sort()[0] || '';
  }

  // Les échéances fiscales qui arrivent, pour le panneau « À faire » et la page Comptabilité.
  // Une échéance déjà déposée ne doit plus crier. La clé est `ruleId + date` : c'est une OCCURRENCE
  // qu'on pointe, pas une règle — la TVA d'octobre se dépose, celle de novembre reste due.
  const fiscalFilingId = (ruleId, dateIso) => `${ruleId}@${dateIso}`;
  function fiscalDone(data) { return new Set((data.fiscalFilings || []).map(f => f.id)); }

  // 10.12.0 — la CNSS et la déclaration annuelle d'employeur avaient DEUX pense-bêtes : l'occurrence
  // du calendrier fiscal (`cnss@2026-10-15`) et la déclaration de la Paie (`cnss-2026-T3`). Pointer
  // l'un laissait l'autre crier, « À faire » nommait la même déclaration deux fois, et le calendrier
  // acceptait « déposée » sur un trimestre pas encore terminé. Une occurrence du calendrier DÉSIGNE
  // la déclaration sociale qu'elle rappelle ; c'est celle de la Paie qui fait foi (une seule source).
  // L'échéance d'un trimestre tombe le mois qui le suit : janvier rappelle le 4e trimestre de l'année
  // d'avant. Celle de l'employeur rappelle l'année d'avant.
  function echeanceSociale(ruleId, dateIso) {
    const y = Number(String(dateIso || '').slice(0, 4)), m = Number(String(dateIso || '').slice(5, 7));
    if (!y || !m) return null;
    if (ruleId === 'cnss') {
      const q = m <= 3 ? 4 : Math.floor((m - 1) / 3);
      const yy = m <= 3 ? y - 1 : y;
      return { id: `cnss-${yy}-T${q}`, fin: addDays(`${yy}-${pad2(q * 3)}-01`, daysInMonth(yy, q * 3) - 1) };
    }
    if (ruleId === 'employeur') return { id: `employeur-${y - 1}`, fin: `${y - 1}-12-31` };
    return null;
  }
  // Les déclarations sociales pointées depuis le calendrier AVANT la 10.12.0 vivent dans
  // `fiscalFilings` : elles comptent encore, par leur équivalent.
  function socialesDeposees(data) {
    const s = new Set((data.socialFilings || []).map(f => f.id));
    (data.fiscalFilings || []).forEach(f => {
      const [r, d] = String(f.id).split('@');
      const soc = echeanceSociale(r, d);
      if (soc) s.add(soc.id);
    });
    return s;
  }

  function upcomingFiscal(data, todayIso, withinDays) {
    const t = todayIso || today();
    const within = Number(withinDays) || 30;
    const done = fiscalDone(data);
    const sociales = socialesDeposees(data);
    const fait = (r, date) => {
      const soc = echeanceSociale(r.id, date);
      return done.has(fiscalFilingId(r.id, date)) || !!(soc && sociales.has(soc.id));
    };
    return fiscalDeadlines(data).filter(r => r.active !== false).map(r => {
      let date = nextDeadline(r, t);
      // Déjà déposée : on saute à l'occurrence suivante plutôt que de faire disparaître la règle —
      // sinon pointer la TVA d'octobre effacerait aussi celle de novembre.
      let garde = 0;
      while (date && fait(r, date) && garde++ < 24) {
        date = nextDeadline(r, addDays(date, 1));
      }
      const soc = date ? echeanceSociale(r.id, date) : null;
      return date ? { id: r.id, label: r.label, note: r.note || '', date, days: daysBetween(t, date),
        filingId: fiscalFilingId(r.id, date), socialId: soc ? soc.id : '', fin: soc ? soc.fin : '',
        enCours: !!(soc && t <= soc.fin) } : null;
    }).filter(x => x && x.days <= within).sort((a, b) => a.date.localeCompare(b.date));
  }

  // Résultat simple de la période : ce que tu as facturé moins ce que tu as dépensé, hors taxes.
  // Ce n'est PAS le résultat comptable : il manque les amortissements, les stocks, les salaires et
  // les provisions. À VÉRIFIER avec le comptable — c'est un ordre de grandeur, pas un bilan.
  function simpleResult(data, company, period) {
    const sales = salesJournal(data, company, period);
    const buys = purchaseJournal(data, company, period);
    const produits = round3(sales.reduce((s, r) => s + r.ht, 0));
    // Une ligne partie au stock ou en immobilisation n'est pas une charge de la période.
    let charges = 0, stock = 0, immo = 0;
    const cogs = costOfGoodsSold(data, period);
    // Ce que chaque destination COÛTE, TVA non déductible comprise (10.14.0) : une dépense de
    // réception à TVA non récupérable coûte son TTC, et l'écriture le passe ainsi au 606.
    (data.purchases || []).filter(p => inPeriod(p.date, period && period.from, period && period.to)).forEach(p => {
      const t = purchaseTotals(p, company);
      charges = round3(charges + t.base.cout.charge + t.base.fees);
      stock = round3(stock + t.base.cout.stock);
      immo = round3(immo + t.base.cout.immobilisation);
    });
    // De la marchandise achetée pour le stock sans article SUIVI n'entre dans aucun stock : aucune
    // sortie ne la valorisera jamais. Elle ne peut être qu'une charge — c'est ce que fait l'écriture
    // (607, sans inventaire). Sans cette ligne, le résultat simplifié l'oubliait (10.14.0).
    const entreesSuivies = round3(stockJournal(data, period).filter(m => m.source === 'achat')
      .reduce((s2, m) => s2 + (Number(m.qty) || 0) * (Number(m.unitApplied) || 0), 0));
    const horsSuivi = round3(stock - entreesSuivies);
    // Ce qui passe au résultat SANS être un achat, une vente ni un bulletin : des frais bancaires
    // payés par un mouvement, une assurance passée en OD, la valeur d'un bien cédé et le prix de sa
    // cession. Le résultat simplifié se présente comme le « résultat avant impôt » : il ne peut pas
    // ignorer ce que les écritures comptent (10.14.0 — sur l'exemple, 144 DT de frais par an).
    const autres = round3(journalEntries(data, company, period, { sections: ['tresorerie', 'od', 'amortissements'] })
      .filter(e => e.source !== 'amortissement' && compteDeGestion(e.account))
      .reduce((s2, e) => s2 + e.debit - e.credit, 0));
    // L'achat d'une immobilisation n'est pas une charge, mais son AMORTISSEMENT en est une : sans lui,
    // le résultat de l'année d'un gros investissement serait artificiellement bon (3.5.0).
    const depreciation = depreciationFor(data, period);
    // La paie n'est pas un achat : elle a sa propre page, mais c'est bien une charge de la période,
    // et la plus lourde de toutes dès qu'il y a un salarié (5.0.0). On compte le COÛT EMPLOYEUR.
    const payroll = payrollCost(data, period);
    // L'écart de change d'un avoir ou d'un acompte à un autre taux que sa pièce (10.14.0) : les
    // écritures le comptent, le résultat simplifié aussi.
    const change = ecartsDeChange(data, company, period);
    const resultat = round3(produits - charges - horsSuivi - cogs - depreciation - payroll - autres + change);
    return {
      produits, charges, stock, immo, cogs, horsSuivi, depreciation, payroll, autres, change, resultat,
      marge: produits > 0 ? Math.round(resultat / produits * 100) : null,
      salesCount: sales.length, buysCount: buys.length
    };
  }

  // ---------- clôture de période (6.0.0) ----------
  // Ce que le comptable a reçu ne doit plus bouger. Sans ça, une pièce saisie en mars après que mars
  // a été déclaré change la TVA de mars en silence, et personne ne le sait avant un contrôle.
  // `data.closedUntil` = dernier jour clôturé ('' si rien). `data.closureLog` garde chaque clôture
  // et chaque réouverture : une réouverture n'est pas interdite, elle est **tracée**.
  const CLOSURE_ACTIONS = { cloture: 'Clôture', reouverture: 'Réouverture' };

  function closedUntil(data) { return (data && typeof data.closedUntil === 'string') ? data.closedUntil : ''; }

  // La question que tout le reste pose : cette date est-elle dans une période close ?
  // Une date vide ne l'est jamais : un brouillon sans date ne se refuse pas, il se date.
  function isClosedDate(data, iso) {
    const c = closedUntil(data);
    return !!(c && iso && String(iso).slice(0, 10) <= c);
  }

  // Le mois clôturé qui contient cette date, pour l'écrire dans le message d'erreur.
  function closedPeriodLabel(data, iso) {
    if (!isClosedDate(data, iso)) return '';
    return monthLabel(String(iso).slice(0, 10));
  }

  // Les dates des pièces qui entrent dans une clôture, triées. UNE liste pour les deux lecteurs :
  // le premier mois proposé à la clôture, et la phrase qui dit pourquoi il n'y en a pas.
  function datesDesPieces(data) {
    return [
      ...(data.documents || []).map(d => d.date),
      ...(data.purchases || []).map(p => p.date),
      ...(data.movements || []).map(m => m.date),
      ...(data.ecrituresOD || []).map(o => o.date)
    ].filter(Boolean).sort();
  }

  // Les mois qu'on peut clôturer aujourd'hui : ceux qui suivent le dernier clôturé et qui sont
  // terminés. On ne propose jamais de clôturer un mois en cours — il lui reste des pièces à recevoir.
  function closableMonths(data, todayIso) {
    const t = todayIso || today();
    const curMonth = t.slice(0, 7);
    const c = closedUntil(data);
    let first;
    if (c) {
      first = addDays(c, 1).slice(0, 7);
    } else {
      // Rien n'a jamais été clôturé : on part du mois de la plus ancienne pièce datée.
      const dates = datesDesPieces(data);
      if (!dates.length) return [];
      first = dates[0].slice(0, 7);
    }
    const out = [];
    let m = first;
    // 120 mois : dix ans de retard suffisent, et la boucle ne peut pas s'emballer.
    while (m < curMonth && out.length < 120) {
      const [y, mm] = m.split('-').map(Number);
      out.push({ month: m, label: monthLabel(m + '-01'), from: `${m}-01`, to: `${m}-${pad2(daysInMonth(y, mm))}` });
      m = addMonths(m + '-01', 1, 1).slice(0, 7);
    }
    return out;
  }

  // Pourquoi il n'y a RIEN à clôturer, quand `closableMonths` rend une liste vide. Trois cas, et le
  // plus trompeur est celui de l'entreprise qui vient de commencer : elle a des pièces, toutes dans
  // le mois en cours. Lui répondre « aucune pièce datée » (le défaut d'avant la 10.12.0) la faisait
  // douter de ce qu'elle venait de saisir. `des` est le jour où le premier mois deviendra clôturable.
  function rienACloturer(data, todayIso) {
    const cur = (todayIso || today()).slice(0, 7);
    const lendemain = mois => addMonths(mois + '-01', 1, 1);
    if (closedUntil(data)) return { cas: 'a-jour', mois: monthLabel(cur + '-01'), des: lendemain(cur) };
    const dates = datesDesPieces(data);
    if (!dates.length) return { cas: 'aucune' };
    // Sans clôture, une liste vide veut dire que la plus ancienne pièce est dans le mois en cours
    // — ou après : un devis daté du mois prochain ne rend clôturable aucun mois avant la fin du sien.
    const premier = dates[0].slice(0, 7) > cur ? dates[0].slice(0, 7) : cur;
    return { cas: 'pas-termine', n: dates.length, mois: monthLabel(premier + '-01'), enCours: premier === cur, des: lendemain(premier) };
  }

  // Ce qu'il vaut mieux régler AVANT de clôturer. On n'interdit rien : on montre, et l'utilisateur
  // décide. Un cabinet préfère un mois clôturé avec deux justificatifs manquants signalés qu'un mois
  // jamais clôturé parce que l'app faisait la difficile.
  // `opts.reserves` : ce que l'offre ferme (10.7.0). Un contrôle qui réclame un geste que l'offre
  // interdit est un reproche adressé à quelqu'un à qui on n'a rien offert (7.20.0).
  function closureChecks(data, company, from, to, opts) {
    const out = [];
    const reserves = (opts && opts.reserves) || [];
    const inRange = d => d && d >= from && d <= to;
    // `extra` : ce dont le bouton de la ligne a besoin pour ouvrir EXACTEMENT l'ensemble qu'elle nomme
    // (7.15.0) — la période, pour les achats sans justificatif.
    const add = (id, level, label, detail, count, extra) => { if (count) out.push({ id, level, label, detail, count, ...(extra || {}) }); };

    const drafts = (data.documents || []).filter(d => d.type === 'facture' && d.status === 'brouillon' && inRange(d.date));
    add('brouillons', 'danger', `${plFr(drafts.length, 'facture')} en brouillon dans la période`,
      'Un brouillon n\'a pas de numéro et n\'entre dans aucun journal. Émets-le ou change sa date avant de clôturer, sinon il restera invisible pour ton comptable.', drafts.length);

    // (plateforme, lot achats) Sans pièces jointes en ligne, « n achats sans justificatif » ne se règle pas : le contrôle se tait.
    const noProof = opts && opts.sansPiecesJointes ? [] : (data.purchases || []).filter(p => inRange(p.date) && sansJustificatif(p));
    add('justificatifs', 'warn', `${plFr(noProof.length, 'achat')} sans justificatif`,
      'Sans la pièce jointe, ton comptable ne peut pas récupérer la TVA de ces achats.', noProof.length, { du: from, au: to });

    const unticked = cashMovements(data, company).filter(m => inRange(m.date) && !m.reconciled);
    add('pointage', 'warn', `${plFr(unticked.length, 'mouvement')} non pointé${sAccord(unticked.length)}`,
      'Pointer les mouvements contre le relevé bancaire, c\'est ce qui prouve que la trésorerie est juste.', unticked.length);

    // Bulletins manquants : un salarié actif sans bulletin sur un mois travaillé.
    // 10.14.1 — TOUS les mois de la période. La boucle s'arrêtait à 24 : « Clôturer jusqu'à… » propose
    // jusqu'à dix ans d'un coup, et annonçait « 24 bulletins de paie à établir » pour quatre-vingts
    // manquants — la seule information qu'on lit avant de verrouiller des années. Le nombre de mois se
    // compte d'avance (règle 5.2.3 : jamais une boucle qui avance une date « jusqu'à » une autre sans
    // borne), et la borne est celle d'un siècle, pas d'une période qu'on peut vraiment choisir.
    const months = [];
    const [ya, ma] = from.slice(0, 7).split('-').map(Number), [yb, mb] = to.slice(0, 7).split('-').map(Number);
    const nbMois = Math.min(1200, Math.max(0, (yb - ya) * 12 + (mb - ma) + 1));
    for (let i = 0, m = from.slice(0, 7); i < nbMois; i++, m = addMonths(m + '-01', 1, 1).slice(0, 7)) months.push(m);
    let slipsMissing = 0, premierManque = '';
    months.forEach(mm => {
      const n = missingPayslips(data, Number(mm.slice(0, 4)), Number(mm.slice(5, 7))).length;
      if (n && !premierManque) premierManque = mm;
      slipsMissing += n;
    });
    add('bulletins', 'danger', `${plFr(slipsMissing, 'bulletin')} de paie à établir`,
      'Un salarié payé sans bulletin, c\'est une charge qui manque au résultat et une déclaration sociale fausse.', slipsMissing);
    // Le premier mois qui manque : « Voir les bulletins » y mène. Sur une période de plusieurs années,
    // arriver sur le mois en cours laissait chercher, année par année, où commençait l'oubli.
    if (premierManque) out[out.length - 1].mois = premierManque;

    const negative = stockList(data).filter(s => s.qty < 0);
    add('stock', 'warn', `${plFr(negative.length, 'article')} en stock négatif`,
      'Un stock négatif est une pièce d\'achat manquante, pas une erreur de comptage.', negative.length);

    const gaps = serialGaps(data);
    add('series', 'warn', `${plFr(gaps.length, 'écart')} entre quantités et numéros de série`,
      'Les deux comptes devraient dire la même chose.', gaps.length);

    // 10.14.1 — une ligne d'achat « immobilisation » sans fiche dans la période. Le bien est au bilan
    // (compte 22) depuis l'achat, son amortissement n'est compté nulle part ; et sa fiche se crée à
    // sa date de mise en service — une date qu'une clôture ferme. Clôturer sans le dire, c'était
    // découvrir en décembre qu'on ne peut plus créer la fiche de l'imprimante de mars sans rouvrir.
    // Quand l'offre ferme le module, c'est le comptable qui établit le plan depuis le paquet (9.7.0) :
    // rien à réclamer ici.
    if (!reserves.includes('immos')) {
      const sansFiche = immosEnAttente(data, to).filter(w => inRange(w.date));
      add('immobilisations', 'warn', `${plFr(sansFiche.length, 'achat')} à immobiliser dans la période`,
        'Sans fiche, le bien est au bilan mais son amortissement n\'est compté nulle part. Et la fiche se crée à la date de mise en service : une fois la période clôturée, elle ne pourra plus l\'être sans rouvrir.', sansFiche.length);
    }

    return out;
  }

  // Clôturer. Renvoie { ok } ou { error } — on ne clôture pas dans le futur, ni en arrière (ça, c'est
  // rouvrir, et ça porte un autre nom pour que ce soit un geste conscient).
  function closePeriod(data, iso, opts) {
    opts = opts || {};
    const t = opts.todayIso || today();
    const day = String(iso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: 'Date de clôture invalide.' };
    if (day > t) return { error: 'On ne clôture pas une période qui n\'est pas terminée.' };
    const c = closedUntil(data);
    if (c && day <= c) return { error: `Déjà clôturé jusqu'au ${fmtDate(c)}. Pour revenir en arrière, il faut rouvrir.` };
    data.closedUntil = day;
    if (!Array.isArray(data.closureLog)) data.closureLog = [];
    data.closureLog.push({ id: uid(), action: 'cloture', until: day, previous: c || '', at: opts.at || null, by: opts.by || '', reason: opts.reason || '' });
    return { ok: true, until: day };
  }

  // Rouvrir jusqu'à une date antérieure (ou tout rouvrir avec ''). Toujours tracé, toujours motivé :
  // c'est cette ligne que le comptable lira le jour où un chiffre a bougé après son envoi.
  function reopenPeriod(data, iso, opts) {
    opts = opts || {};
    const c = closedUntil(data);
    if (!c) return { error: 'Aucune période n\'est clôturée.' };
    const day = iso ? String(iso).slice(0, 10) : '';
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: 'Date de réouverture invalide.' };
    if (day && day >= c) return { error: 'La réouverture doit porter sur une date antérieure à la clôture actuelle.' };
    if (!opts.reason) return { error: 'Une réouverture demande un motif : c\'est lui qui explique au comptable pourquoi un chiffre a changé.' };
    data.closedUntil = day;
    if (!Array.isArray(data.closureLog)) data.closureLog = [];
    data.closureLog.push({ id: uid(), action: 'reouverture', until: day, previous: c, at: opts.at || null, by: opts.by || '', reason: opts.reason });
    return { ok: true, until: day };
  }

  function closureLog(data) {
    return (Array.isArray(data.closureLog) ? data.closureLog : []).slice().reverse();
  }


  // ---------- le paquet mensuel pour le cabinet (6.1.0) ----------
  // Un fichier unique, complet, vérifiable, que le comptable ouvre sans rien installer. Tout ce qui
  // décide de son CONTENU vit ici : c'est pur, donc testable sans Electron. L'écriture du fichier
  // (zip, chiffrement, PDF) est dans main.js, parce qu'elle a besoin du disque.
  const PACK_FORMAT = 1;

  // Les colonnes des journaux, définies une seule fois : le CSV exporté à la main et celui du paquet
  // doivent dire exactement la même chose, sinon deux exports du même mois ne se ressemblent pas.
  function salesCsvColumns() {
    return [
      { key: 'date', label: 'Date', type: 'date' }, { key: 'number', label: 'Numéro' }, { key: 'typeLabel', label: 'Type' },
      { key: 'client', label: 'Client' }, { key: 'subject', label: 'Objet' }, { key: 'ht', label: 'Total HT', type: 'money' },
      ...VAT_RATES.map(r => ({ label: `Base ${r}%`, type: 'money', get: x => x.vatByRate[r].base })),
      ...VAT_RATES.map(r => ({ label: `TVA ${r}%`, type: 'money', get: x => x.vatByRate[r].vat })),
      { key: 'tva', label: 'Total TVA', type: 'money' }, { key: 'timbre', label: 'Timbre', type: 'money' }, { key: 'ttc', label: 'TTC', type: 'money' },
      { key: 'rs', label: 'Retenue source', type: 'money' }, { key: 'net', label: 'Net à payer', type: 'money' },
      { key: 'statusLabel', label: 'Statut' }, { key: 'paid', label: 'Payé', type: 'money' }, { key: 'remaining', label: 'Reste', type: 'money' }
    ];
  }
  function buyCsvColumns() {
    return [
      // « Pièce » est la référence des écritures (10.14.1, LET-01) : le numéro du fournisseur, ou
      // « SN-AAAAMMJJ » pour un ticket qui n'en a pas — le nom de son dossier dans le paquet.
      { key: 'date', label: 'Date', type: 'date' }, { key: 'number', label: 'N° fournisseur' }, { key: 'piece', label: 'Pièce' }, { key: 'supplier', label: 'Fournisseur' },
      { key: 'kind', label: 'Nature' }, { key: 'category', label: 'Catégorie' }, { key: 'subject', label: 'Objet' },
      { key: 'ht', label: 'HT', type: 'money' }, { key: 'tva', label: 'TVA', type: 'money' }, { key: 'deductible', label: 'TVA déductible', type: 'money' },
      { key: 'fees', label: 'Timbre et frais', type: 'money' }, { key: 'ttc', label: 'TTC', type: 'money' },
      // La retenue que la pièce PORTE : elle s'opère au règlement (10.14.0), et c'est le journal des
      // règlements qui dit quand.
      { key: 'rs', label: 'Retenue à la source', type: 'money' }, { key: 'net', label: 'Net à payer', type: 'money' }, { key: 'status', label: 'Statut' }
    ];
  }
  function payCsvColumns() {
    return [
      { key: 'date', label: 'Date', type: 'date' }, { key: 'number', label: 'Facture' }, { key: 'client', label: 'Client' },
      { key: 'amount', label: 'Montant', type: 'money' },
      // La retenue que le client a gardée sur CET encaissement (10.14.0) : c'est elle que la
      // déclaration du mois porte comme retenue subie.
      { key: 'rs', label: 'Retenue subie', type: 'money' },
      { key: 'method', label: 'Mode' }, { key: 'reference', label: 'Référence' }, { key: 'note', label: 'Note' }
    ];
  }
  function supplierPayCsvColumns() {
    return [
      { key: 'date', label: 'Date', type: 'date' }, { key: 'number', label: 'Pièce fournisseur' }, { key: 'piece', label: 'Pièce' }, { key: 'supplier', label: 'Fournisseur' },
      { key: 'amount', label: 'Montant', type: 'money' },
      // La retenue que CE règlement a opérée (10.14.0) : c'est elle que la déclaration du mois reverse.
      { key: 'rs', label: 'Retenue opérée', type: 'money' },
      { key: 'method', label: 'Mode' }, { key: 'reference', label: 'Référence' }, { key: 'note', label: 'Note' }
    ];
  }
  function cashCsvColumns() {
    return [
      { key: 'date', label: 'Date', type: 'date' }, { key: 'label', label: 'Libellé' }, { key: 'kindLabel', label: 'Nature' },
      { key: 'accountName', label: 'Compte' }, { key: 'inAmount', label: 'Entrée', type: 'money' }, { key: 'outAmount', label: 'Sortie', type: 'money' },
      { key: 'reference', label: 'Référence' }, { key: 'reconciled', label: 'Pointé' }
    ];
  }
  // Les LIGNES du journal de trésorerie, dans la forme que ses colonnes réclament. `cashMovements`
  // rend `kind`, `accountId` et un `amount` signé ; les colonnes demandaient `kindLabel`,
  // `accountName`, `inAmount` et `outAmount` — quatre clés que personne n'écrivait, donc quatre
  // colonnes vides dans CHAQUE paquet envoyé depuis la 6.1.0, sans qu'aucun message ne le dise
  // (T-01). Un test confronte désormais chaque clé des colonnes aux lignes produites ici.
  function cashCsvRows(data, moves) {
    const accName = id => ((data.accounts || []).find(a => a.id === id) || {}).name || '';
    const nature = m => m.source === 'vente' ? (m.amount < 0 ? 'Remboursement client' : 'Encaissement client')
      : m.source === 'achat' ? 'Règlement fournisseur'
        : m.source === 'paie' ? 'Salaire'
          : m.party || 'Mouvement';
    return (moves || []).map(m => ({
      ...m,
      kindLabel: nature(m), accountName: accName(m.accountId),
      inAmount: m.amount > 0 ? m.amount : 0, outAmount: m.amount < 0 ? round3(-m.amount) : 0,
      reconciled: m.reconciled ? 'oui' : 'non'
    }));
  }

  // Nom de fichier : lisible d'un coup d'œil dans une boîte mail encombrée, et triable.
  function packFileName(company, period, definitive) {
    const slug = String(company.name || 'entreprise').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'entreprise';
    return `${slug}-${period.month}${definitive ? '' : '-provisoire'}.skanpack`;
  }

  // Le mois, borné aux vrais jours du calendrier.
  function packPeriod(year, month) {
    const y = Number(year), m = Number(month);
    const mm = String(m).padStart(2, '0');
    return { month: `${y}-${mm}`, from: `${y}-${mm}-01`, to: `${y}-${mm}-${pad2(daysInMonth(y, m))}`, label: monthLabel(`${y}-${mm}-01`) };
  }

  // Ce qui manque dans ce mois, du point de vue du comptable. On reprend les contrôles de clôture —
  // ce sont les mêmes questions — et on ajoute ce qui ne se voit qu'à l'envoi.
  function packChecklist(data, company, period, opts) {
    const out = closureChecks(data, company, period.from, period.to, opts).slice();
    // Un client qui t'a payé ce mois en gardant une retenue à la source, et dont l'attestation n'est
    // pas arrivée. C'est LUI qui la remet (10.14.0) : la phrase disait l'inverse — « non remise… ton
    // client ne peut pas justifier » —, et elle comptait les factures DATÉES du mois, payées ou non.
    const certs = attestationsARecevoir(data, company, period);
    if (certs.length) out.push({
      id: 'attestations', level: 'warn', count: certs.length,
      label: `${plFr(certs.length, 'attestation')} de retenue à la source à recevoir de tes clients`,
      detail: 'Un client qui te paie en gardant une retenue te remet son attestation : sans elle, tu ne peux pas déduire cette retenue de ton impôt.'
    });
    return out;
  }

  // ---------- les justificatifs (10.14.1, S-04) ----------
  //
  // Skander : « quand je cherche une pièce jointe je la trouve pas, et il faut qu'on voie quand une
  // ligne a un justificatif — c'est ce qui part au comptable, et c'est grâce à ça qu'on prouve tout ».
  // Un fichier joint vit sur SA pièce : un document, un achat, un mouvement libre. Une ligne DÉDUITE
  // — un encaissement, un règlement, une écriture — montre ceux de la pièce d'où elle vient : on ne
  // joint pas deux fois la même facture, et le 📎 d'un règlement est celui de l'achat qu'il paie.
  // La règle qui fait un achat « sans justificatif » : UNE fonction pour le contrôle de clôture qui
  // les compte et pour le filtre de la liste qui les montre (6.8.1 : un compteur et la liste qu'il
  // annonce se calculent avec la même fonction).
  // (plateforme 1.173.0) Un achat dont le cabinet a joint la pièce dans son classeur (Skander, 29/10/2026 : « oui, tout ») est
  // justifié aussi chez le client : `justifCabinet`, posé à la lecture (non énumérable : il ne s'écrit jamais dans le dossier).
  function sansJustificatif(p) { return !((p && p.attachments) || []).length && !(p && p.justifCabinet); }
  function nomsJustificatifs(x) {
    return ((x && x.attachments) || []).map(a => (a && a.name) || '').filter(Boolean).join(' ');
  }
  function justificatifsDe(data, x) {
    if (!x) return [];
    if (Array.isArray(x.attachments)) return x.attachments;
    const dans = (liste, id) => (id && ((data && data[liste]) || []).find(y => y.id === id) || {}).attachments || [];
    if (x.movementId) return dans('movements', x.movementId);
    if (x.purchaseId) return dans('purchases', x.purchaseId);
    const s = x.source;
    if (s === 'achat' || s === 'règlement') return dans('purchases', x.docId);
    if (s === 'mouvement') return dans('movements', x.docId);
    if (s === 'vente' || s === 'encaissement') return dans('documents', x.docId);
    return [];
  }
  // Le dossier d'un justificatif dans le paquet : lisible, et sans rien que le système refuse dans un
  // nom (le numéro d'une pièce porte des « / » chez certains fournisseurs). Les LETTRES de toutes les
  // écritures restent (`\p{L}`, règle 6.8.1) : le ZIP porte ses noms en UTF-8, et `\w` changeait
  // « quittance août.pdf » en « quittance ao_t.pdf » — et deux noms en arabe en le même « ____.pdf ».
  const dossierDuPaquet = s => String(s || '').replace(/[^\p{L}\p{N}_.-]+/gu, '_') || 'piece';
  const nomDansPaquet = a => String(a.name || a.file || '').replace(/[^\p{L}\p{N}_.\- ]+/gu, '_').trim() || 'fichier';

  // Le plan du paquet : la liste exacte de ce qu'il contiendra, chaque entrée sachant d'où vient son
  // contenu. main.js n'a plus qu'à exécuter ce plan. Le séparer ainsi permet de le tester entièrement
  // sans Electron, et de montrer à l'utilisateur ce qui va partir AVANT de le fabriquer.
  function packPlan(data, company, period, opts) {
    opts = opts || {};
    const entries = [];
    const inRange = d => d && d >= period.from && d <= period.to;
    // Deux fichiers ne partent jamais sous le même chemin (10.14.1, S-04) : deux justificatifs nommés
    // « facture.pdf » sur la même pièce faisaient deux entrées identiques dans le ZIP, et le
    // comptable n'en voyait qu'une. Le second devient « facture (2).pdf ».
    const pris = new Set();
    const unique = chemin => {
      let c = chemin, n = 2;
      while (pris.has(c)) { c = chemin.replace(/(\.[^./]*)?$/, m => ` (${n})${m}`); n++; }
      pris.add(c); return c;
    };
    const add = e => { e.path = unique(e.path); entries.push(e); return e; };

    // 1. Les journaux, en CSV — ce que le comptable saisit dans son logiciel.
    const sales = salesJournal(data, company, period);
    const buys = purchaseJournal(data, company, period);
    const pays = paymentsJournal(data, company, period);
    const supPays = supplierPayments(data, company, period);
    const cash = cashMovements(data, company, period);
    add({ path: 'journaux/ventes.csv', kind: 'text', label: 'Journal des ventes', text: toCsv(sales, salesCsvColumns()), rows: sales.length });
    add({ path: 'journaux/achats.csv', kind: 'text', label: 'Journal des achats', text: toCsv(buys, buyCsvColumns()), rows: buys.length });
    add({ path: 'journaux/encaissements.csv', kind: 'text', label: 'Encaissements clients', text: toCsv(pays, payCsvColumns()), rows: pays.length });
    add({ path: 'journaux/reglements-fournisseurs.csv', kind: 'text', label: 'Règlements fournisseurs', text: toCsv(supPays, supplierPayCsvColumns()), rows: supPays.length });
    add({ path: 'journaux/tresorerie.csv', kind: 'text', label: 'Mouvements de trésorerie', text: toCsv(cashCsvRows(data, cash), cashCsvColumns()), rows: cash.length });

    // 1 bis. Les écritures en partie double. C'est le fichier qui fait gagner des heures au cabinet :
    // il l'importe au lieu de retaper les pièces une à une. Les numéros de compte sont ceux réglés
    // par l'entreprise — À VÉRIFIER, et c'est écrit dans le fichier comme sur la page de garde.
    // Par `livreJournal`, comme l'écran (rapport QA E-07) : `journalEntries` ne numérote pas, et la
    // colonne « N° » du fichier — celle qui regroupe les lignes en pièces à l'import — partait VIDE,
    // pendant que l'écran promettait des numéros qui ne bougent plus.
    const ecritures = livreJournal(data, company, period, {});
    const balance = entriesBalance(ecritures);
    add({ path: 'journaux/ecritures.csv', kind: 'text', label: 'Écritures comptables (partie double)', text: toCsv(ecritures, entryCsvColumns()), rows: ecritures.length });
    // 1 ter. La balance du mois (8.8.0) : ouverture, mouvements, soldes — le premier document que le
    // cabinet tire pour contrôler un dossier, et le seul qui dise d'un coup d'œil où en sont les tiers.
    const bal = balanceGenerale(data, company, period, {});
    add({ path: 'journaux/balance.csv', kind: 'text', label: 'Balance générale', text: toCsv(bal.rows, balanceCsvColumns()), rows: bal.rows.length });

    // 2. La TVA du mois, avec son report : un mois isolé sans le crédit reporté donne un chiffre faux.
    // Le mois tel que la CHAÎNE des déclarations le calcule (10.14.0). Avant, le paquet reprenait
    // le crédit de début d'année pour CHAQUE mois : dès qu'un mois laissait un crédit, le suivant
    // annonçait au comptable une TVA à décaisser qui l'ignorait (mars de l'exemple : 286,729 DT au
    // lieu de 52,079), et un crédit saisi en janvier se déduisait douze fois. Une déclaration isolée
    // ignore le report (3.1.0) : seule `vatChain` le porte.
    const [anVat, moisVat] = period.month.split('-').map(Number);
    const vat = { ...vatChain(data, company, anVat, moisVat)[moisVat - 1], period };
    add({ path: 'journaux/tva.json', kind: 'text', label: 'TVA du mois', text: JSON.stringify(vat, null, 2) });

    // 2 bis. Les réponses aux questions du cabinet (9.10.0). Elles voyagent DANS le paquet plutôt
    // que dans un fichier à part : c'est déjà le geste mensuel, et une réponse qu'il faut penser à
    // envoyer séparément n'est jamais envoyée. Le fichier n'existe que s'il y a quelque chose à
    // dire — un `reponses.json` vide dans chaque paquet apprendrait au cabinet à ne plus l'ouvrir.
    const reponses = Compta.reponsesAEnvoyer(data.questionsCabinet || []);
    if (reponses.length) {
      add({ path: 'reponses.json', kind: 'text', label: `Réponses à ton comptable (${plFr(reponses.length, 'question')})`,
        text: JSON.stringify({ format: 1, reponses }, null, 2), rows: reponses.length });
    }

    // 3. Le PDF de chaque pièce émise. C'est le justificatif, pas le tableau.
    const issued = (data.documents || []).filter(d => (d.type === 'facture' || d.type === 'avoir')
      && inRange(d.date) && d.status !== 'brouillon');
    issued.forEach(d => add({
      path: `ventes/${(d.number || d.id).replace(/[^\w.-]+/g, '_')}.pdf`,
      kind: 'pdf', label: `${TITLES[d.type] || 'Pièce'} ${d.number || ''}`, docId: d.id, docType: d.type
    }));
    // 3 bis. Ce que l'utilisateur a joint à une pièce de vente émise (10.14.1, S-04) : le bon de
    // commande du client, le devis signé, le procès-verbal de réception. Il l'a joint pour prouver
    // quelque chose, et c'est au comptable que la preuve sert. Rangé à côté du PDF de la pièce.
    issued.forEach(d => (d.attachments || []).forEach(a => add({
      path: `ventes/${dossierDuPaquet(d.number || d.id)}/${nomDansPaquet(a)}`,
      kind: 'attachment', label: `Justificatif ${d.number || ''}`, ownerId: d.id, file: a.file
    })));

    // 4. Les justificatifs d'achat. Sans eux, la TVA déductible n'est pas récupérable.
    (data.purchases || []).filter(p => inRange(p.date)).forEach(p => {
      (p.attachments || []).forEach(a => add({
        path: `achats/${dossierDuPaquet(referenceAchat(p, data))}/${nomDansPaquet(a)}`,
        kind: 'attachment', label: `Justificatif ${referenceAchat(p, data)}`, ownerId: p.id, file: a.file
      }));
    });
    // 4 bis. Ceux d'un mouvement libre (10.14.1, S-04) : la quittance d'un loyer payé sans facture,
    // l'avis d'imposition, le relevé qui prouve des frais bancaires. Un mouvement sans facture n'a
    // QUE ce fichier pour se justifier.
    (data.movements || []).filter(m => inRange(m.date)).forEach(m => {
      (m.attachments || []).forEach(a => add({
        path: `tresorerie/${dossierDuPaquet(`${m.date}_${m.reference || m.label || m.id}`)}/${nomDansPaquet(a)}`,
        kind: 'attachment', label: `Justificatif du mouvement ${m.label || m.reference || ''}`.trim(), ownerId: m.id, file: a.file
      }));
    });
    // 4 ter. Où va chaque justificatif (10.14.1, S-04) : la pièce comptable qu'il prouve, par la clé
    // qui la désigne dans `ecritures.csv` (journal, pièce, date). Le cabinet s'en sert pour poser le
    // 📎 sur l'écriture et l'ouvrir d'un clic. On lit la clé dans les ÉCRITURES du mois plutôt que de
    // la refabriquer : un règlement ou une imputation porte le même document, et seule l'écriture de
    // la pièce elle-même (vente, achat, mouvement) désigne le justificatif.
    const piecesJointes = entries.filter(e => e.kind === 'attachment');
    if (piecesJointes.length) {
      const cleDe = {};
      ecritures.forEach(e => {
        if (!e.docId || cleDe[e.docId] || !['vente', 'achat', 'mouvement'].includes(e.source)) return;
        cleDe[e.docId] = { journal: e.journal, piece: e.piece, date: e.date };
      });
      const liens = piecesJointes.map(e => ({ chemin: e.path, nom: e.path.split('/').pop(), ...(cleDe[e.ownerId] || {}) }));
      add({ path: 'justificatifs.json', kind: 'text', label: 'Où va chaque justificatif',
        text: JSON.stringify({ format: 1, justificatifs: liens }, null, 2), rows: liens.length });
    }

    // 5. Les bulletins du mois.
    const slips = (data.payslips || []).filter(s => `${s.year}-${String(s.month).padStart(2, '0')}` === period.month);
    slips.forEach(s => {
      const emp = (data.employees || []).find(e => e.id === s.employeeId) || {};
      add({ path: `paie/${String(emp.name || s.employeeId).replace(/[^\w.-]+/g, '_')}.pdf`, kind: 'payslip', label: `Bulletin ${emp.name || ''}`, slipId: s.id });
    });

    // 6. La déclaration CNSS, seulement si le trimestre se termine ce mois-ci.
    const m = Number(period.month.slice(5, 7));
    if (m % 3 === 0 && (data.employees || []).length) {
      const q = m / 3;
      const dec = cnssDeclaration(data, Number(period.month.slice(0, 4)), q);
      if (dec && dec.rows && dec.rows.length) {
        add({ path: `social/cnss-T${q}.json`, kind: 'text', label: `Déclaration CNSS T${q}`, text: JSON.stringify(dec, null, 2) });
      }
    }

    const checklist = packChecklist(data, company, period, opts);
    const definitive = isClosedDate(data, period.to);
    const manifest = {
      format: PACK_FORMAT,
      app: 'SkanFact',
      entreprise: { nom: company.name || '', matricule: company.matricule || '', devise: company.currency || 'TND' },
      periode: { mois: period.month, du: period.from, au: period.to, libelle: period.label },
      definitif: definitive,
      cloturéJusquAu: closedUntil(data) || null,
      genereLe: opts.at || null,
      poste: opts.device || '',
      manques: checklist.map(c => ({ id: c.id, niveau: c.level, quoi: c.label, combien: c.count })),
      fichiers: []          // rempli par main.js une fois chaque fichier produit, avec son empreinte
    };

    const vs = vatSummary(sales);
    const bs = purchaseSummary(buys);

    // Les chiffres du mois DANS le manifeste : le cabinet peut alors afficher le chiffre d'affaires
    // et la TVA de chaque dossier sans ouvrir un seul CSV. Champ ajouté après coup, donc toujours
    // facultatif à la lecture — un paquet d'une version antérieure n'en a pas.
    manifest.chiffres = {
      ca: vs.ht, tvaCollectee: vs.tva, tvaDeductible: (bs && bs.deductible) || 0,
      tvaADecaisser: vat.toPay, creditTva: vat.carryOut,
      encaisse: round3(pays.reduce((s2, r) => s2 + (Number(r.amount) || 0), 0)),
      devise: company.currency || 'TND'
    };
    manifest.compte = {
      ventes: sales.length, achats: buys.length, encaissements: pays.length,
      pieces: issued.length, justificatifs: entries.filter(e => e.kind === 'attachment').length,
      bulletins: slips.length
    };
    return {
      manifest, entries, checklist, definitive, period, balance, sceau: sceauEcritures(ecritures),
      ca: vs.ht, tvaCollectee: vs.tva, tvaDeductible: (bs && bs.deductible) || 0,
      encaisse: round3(pays.reduce((s2, r) => s2 + (Number(r.amount) || 0), 0)),
      totaux: {
        ventes: sales.length, achats: buys.length, encaissements: pays.length,
        pieces: issued.length, justificatifs: entries.filter(e => e.kind === 'attachment').length,
        bulletins: slips.length
      }
    };
  }

  // Ce que le comptable a reçu, résumé : le débit et le crédit de chaque compte du mois (10.14.0).
  // Rangé avec le paquet, il permet de DIRE qu'un mois a changé depuis son envoi — une réouverture,
  // ou une version de SkanFact qui corrige un calcul. Un paquet fabriqué ne se réécrit pas : c'est
  // l'utilisateur qui doit le refaire, et il ne le fera que si on le lui dit.
  function sceauEcritures(lignes) {
    const c = {};
    (lignes || []).forEach(e => {
      const x = c[e.account] || (c[e.account] = [0, 0]);
      x[0] = round3(x[0] + (Number(e.debit) || 0)); x[1] = round3(x[1] + (Number(e.credit) || 0));
    });
    return c;
  }
  // Les comptes dont le débit ou le crédit n'est plus le même, triés par numéro.
  function ecartsSceau(avant, maintenant) {
    const a = avant || {}, b = maintenant || {};
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
      .map(account => ({ account, avant: a[account] || [0, 0], maintenant: b[account] || [0, 0] }))
      .filter(x => Math.abs(x.avant[0] - x.maintenant[0]) > 0.0005 || Math.abs(x.avant[1] - x.maintenant[1]) > 0.0005);
  }

  // La page de garde du paquet : la première chose que le comptable ouvre. Elle répond à trois
  // questions dans cet ordre — de qui, pour quel mois, et **qu'est-ce qui manque**. Un dossier dont
  // on connaît les trous vaut mieux qu'un dossier qu'on croit complet.
  function packCoverHtml(plan, company, opts) {
    opts = opts || {};
    const cur = company.currency || 'TND';
    const m = n => money(n, cur);
    const accent = company.accentColor || '#0f9d8f';
    const p = plan.period;
    const t = plan.totaux;
    const rows = (plan.checklist || []);
    const esc = escapeHtml;
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><style>
      @page { size: A4; margin: 16mm 14mm; }
      * { box-sizing: border-box; }
      body { font: 11pt/1.45 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1b2430; margin: 0; }
      h1 { font-size: 20pt; margin: 0 0 2mm; }
      h2 { font-size: 12pt; margin: 8mm 0 2mm; padding-bottom: 1.5mm; border-bottom: 1.5pt solid ${esc(accent)}; }
      .sub { color: #5c6875; margin: 0 0 6mm; }
      .tag { display: inline-block; padding: 1mm 3mm; border-radius: 3mm; font-size: 9pt; font-weight: 600; }
      .def { background: ${esc(accent)}22; color: ${esc(accent)}; }
      .prov { background: #fbf1e0; color: #a15c00; }
      table { width: 100%; border-collapse: collapse; font-size: 10pt; }
      td, th { text-align: left; padding: 1.6mm 2mm; border-bottom: 0.4pt solid #e3e8ee; vertical-align: top; }
      th { color: #5c6875; font-weight: 600; font-size: 9pt; text-transform: uppercase; letter-spacing: .04em; }
      .r { text-align: right; font-variant-numeric: tabular-nums; }
      .grid { display: flex; gap: 4mm; flex-wrap: wrap; }
      .card { flex: 1 1 34mm; border: 0.5pt solid #e3e8ee; border-radius: 2mm; padding: 3mm; }
      .card .k { font-size: 8.5pt; color: #5c6875; }
      .card .v { font-size: 15pt; font-weight: 600; }
      .warn td { background: #fdf6ec; }
      .danger td { background: #fdeeec; }
      .none { color: ${esc(accent)}; font-weight: 600; }
      .foot { margin-top: 10mm; font-size: 8.5pt; color: #5c6875; border-top: 0.4pt solid #e3e8ee; padding-top: 2.5mm; }
    </style></head><body>
      <h1>${esc(company.name || 'Entreprise')} — ${esc(p.label)}</h1>
      <p class="sub">${company.matricule ? 'Matricule fiscal ' + esc(matriculeLisible(company.matricule)) + ' · ' : ''}du ${fmtDate(p.from)} au ${fmtDate(p.to)}
        &nbsp; <span class="tag ${plan.definitive ? 'def' : 'prov'}">${plan.definitive ? 'DÉFINITIF — mois clôturé' : 'PROVISOIRE — mois non clôturé'}</span></p>

      ${plan.definitive ? '' : '<p style="background:#fbf1e0;padding:3mm;border-radius:2mm;font-size:9.5pt;margin:0 0 5mm"><b>Ce dossier peut encore changer.</b> Le mois n\'a pas été clôturé dans SkanFact : des pièces peuvent encore y être ajoutées ou modifiées. Un envoi définitif suivra une fois le mois clôturé.</p>'}

      <h2>Le mois en chiffres</h2>
      <div class="grid">
        <div class="card"><div class="k">Chiffre d'affaires HT</div><div class="v">${m(plan.ca || 0)}</div></div>
        <div class="card"><div class="k">TVA collectée</div><div class="v">${m(plan.tvaCollectee || 0)}</div></div>
        <div class="card"><div class="k">TVA déductible</div><div class="v">${m(plan.tvaDeductible || 0)}</div></div>
        <div class="card"><div class="k">Encaissé</div><div class="v">${m(plan.encaisse || 0)}</div></div>
      </div>

      <h2>Ce que contient ce paquet</h2>
      <table><tbody>
        <tr><td>Pièces de vente émises (PDF joints)</td><td class="r">${t.pieces}</td></tr>
        <tr><td>Lignes au journal des ventes</td><td class="r">${t.ventes}</td></tr>
        <tr><td>Lignes au journal des achats</td><td class="r">${t.achats}</td></tr>
        <tr><td>Justificatifs joints (achats, ventes, mouvements)</td><td class="r">${t.justificatifs}</td></tr>
        <tr><td>Encaissements clients</td><td class="r">${t.encaissements}</td></tr>
        <tr><td>Bulletins de paie</td><td class="r">${t.bulletins}</td></tr>
      </tbody></table>

      <h2>Écritures comptables</h2>
      <p>Le fichier <b>journaux/ecritures.csv</b> contient ${plan.balance ? plan.balance.lines : 0} lignes d'écritures en partie double
      (${plan.balance ? plan.balance.pieces : 0} pièces), ${plan.balance && plan.balance.balanced ? 'équilibrées&nbsp;: débit = crédit = ' + esc(m(plan.balance.debit)) : '<b>déséquilibrées — à vérifier avant import</b>'}.
      Les numéros de compte sont ceux réglés dans SkanFact par l'entreprise&nbsp;: <i>à adapter au plan du cabinet si besoin</i>.</p>

      <h2>Ce qui manque</h2>
      ${rows.length
        ? `<table><thead><tr><th>Point</th><th class="r">Nombre</th></tr></thead><tbody>
            ${rows.map(c => `<tr class="${esc(c.level)}"><td><b>${esc(c.label)}</b><div style="color:#5c6875;font-size:9pt">${esc(c.detail)}</div></td><td class="r">${c.count}</td></tr>`).join('')}
          </tbody></table>`
        : '<p class="none">Rien à signaler : le dossier est complet.</p>'}

      <div class="foot">
        Paquet produit par SkanFact${opts.version ? ' ' + esc(opts.version) : ''}${opts.at ? ' le ' + esc(opts.at) : ''}${plan.manifest.poste ? ' depuis « ' + esc(plan.manifest.poste) + ' »' : ''}.
        Le fichier <b>manifeste.json</b> liste chaque fichier du paquet avec son empreinte : elles permettent de vérifier que rien n'a été modifié depuis l'envoi.
        <br>Les montants sont ceux enregistrés dans SkanFact. <i>À VÉRIFIER par le comptable</i> avant toute déclaration.
      </div>
    </body></html>`;
  }

  // ---------- écritures comptables (Cabinet 1.1.0) ----------
  //
  // Ce que le comptable fait aujourd'hui : il retape les pièces de son client dans son logiciel.
  // Ce module produit directement les écritures en partie double, prêtes à importer. C'est le seul
  // gain de temps qui se mesure en heures, pas en minutes — et c'est l'argument qui fait installer
  // SkanFact Cabinet.
  //
  // AUCUN numéro de compte n'est certain : le plan comptable tunisien a ses usages, et chaque cabinet
  // les siens. Tous les comptes sont donc **modifiables** (`data.chartAccounts`) et l'écran comme
  // l'export portent un « À VÉRIFIER » visible. Ce qui est garanti ici, c'est l'équilibre :
  // débit = crédit sur chaque pièce, toujours.
  const DEFAULT_ACCOUNTS = {
    clients: '411',              // Clients
    fournisseurs: '401',         // Fournisseurs d'exploitation
    ventes: '706',               // Prestations de services (707 pour les ventes de marchandises)
    tvaCollectee: '4367',        // TVA collectée
    tvaDeductible: '4366',       // TVA déductible
    timbre: '4368',              // Timbre fiscal encaissé pour le compte de l'État
    fodec: '4369',               // (1.155.0) FODEC collectée sur les produits fabriqués — À VÉRIFIER (le compte exact)
    rsSubie: '4358',             // Retenue à la source subie par l'entreprise (créance sur l'État)
    rsOperee: '4352',            // Retenue à la source opérée sur un fournisseur (dette envers l'État)
    achatsStock: '607',          // Achats de marchandises destinées à la revente
    charges: '606',              // Achats consommés (fournitures, services)
    immobilisations: '22',       // Immobilisations corporelles — le compte exact dépend du bien (8.8.0 : 22, le 24 du SCE est « à statut juridique particulier »)
    fraisAccessoires: '608',     // Frais accessoires d'achat (transport, douane)
    avancesFournisseurs: '409',  // Avances et acomptes versés à un fournisseur (10.2.0) — À VÉRIFIER

    banque: '532',               // Banques
    caisse: '54',                // Caisse
    salairesBruts: '640',        // Rémunérations du personnel
    chargesPatronales: '645',    // Charges sociales patronales
    personnel: '425',            // Personnel — rémunérations dues
    cnss: '4531',                // CNSS (part salariale + part patronale)
    irpp: '4321',                // IRPP et contribution sociale retenus à la source
    resultat: '13',              // Résultat de l'exercice — reçoit les exercices passés à l'ouverture (8.8.0)
    // 8.9.0 — les contreparties des mouvements libres et de la déclaration mensuelle
    tvaAPayer: '4365',           // TVA à payer : le net de la déclaration du mois, timbres et retenues opérées compris
    fraisBancaires: '627',       // Services bancaires
    impots: '434',               // État — acomptes provisionnels et impôts réglés sans autre précision
    associes: '4421',            // Associés — comptes courants : apports, retraits, dividendes
    emprunts: '16',              // Emprunts : déblocage et échéances (capital)
    attente: '471',              // Compte d'attente : ce que le comptable ventilera
    reportANouveau: '12',        // Résultats reportés : contrepartie des soldes de départ saisis à la main
    // 9.0.0 — l'exercice : amortissements, cessions, taxes sur salaires
    dotations: '681',            // Dotations aux amortissements
    amortissements: '28',        // Amortissements des immobilisations (cumul)
    vncCedee: '675',             // Valeur comptable des immobilisations cédées
    produitsCession: '775',      // Produits des cessions d'immobilisations
    taxesSalaires: '661',        // TFP et FOPROLOS : impôts et taxes sur rémunérations (charge)
    tfpFoprolos: '4335',         // TFP et FOPROLOS à payer (dette envers l'État)
    // 9.7.0 — l'inventaire de fin d'exercice et les subventions d'investissement. Les rôles vivent
    // ici parce que `COMPTES_IMMO` (compta.js) n'est que le repli du Cabinet : un test confronte
    // les deux tables, sans quoi elles diraient un jour deux numéros différents pour un seul rôle.
    stocks: '37',                // Stocks de marchandises et de matières
    variationStocks: '603',      // Variation des stocks — la contrepartie de l'inventaire
    subventions: '14',           // Subventions d'investissement (À VÉRIFIER)
    repriseSubventions: '739',   // Quote-part de subvention reprise au résultat (À VÉRIFIER)
    // 10.14.0 — l'écart de change d'un avoir (ou d'un acompte) à un autre taux que la pièce qu'il
    // diminue : le client doit ce qu'il doit dans SA devise, et le 411 le porte au taux de la
    // facture ; la différence est un gain ou une perte de change (À VÉRIFIER).
    pertesChange: '655',         // Pertes de change
    gainsChange: '755'           // Gains de change
  };
  const ACCOUNT_LABELS = {
    clients: 'Clients', fournisseurs: 'Fournisseurs', ventes: 'Ventes',
    tvaCollectee: 'TVA collectée', tvaDeductible: 'TVA déductible', timbre: 'Timbre fiscal', fodec: 'FODEC collectée',
    rsSubie: 'Retenue à la source subie', rsOperee: 'Retenue à la source opérée',
    achatsStock: 'Achats de marchandises', charges: 'Charges', immobilisations: 'Immobilisations',
    fraisAccessoires: 'Frais accessoires d\'achat', avancesFournisseurs: 'Avances et acomptes versés',
    banque: 'Banque', caisse: 'Caisse',
    salairesBruts: 'Salaires bruts', chargesPatronales: 'Charges patronales',
    personnel: 'Personnel — net à payer', cnss: 'CNSS', irpp: 'IRPP retenu',
    resultat: 'Résultat des exercices passés',
    tvaAPayer: 'TVA à payer', fraisBancaires: 'Frais bancaires', impots: 'Impôts et acomptes réglés',
    associes: 'Compte courant des associés', emprunts: 'Emprunts', attente: 'Compte d\'attente (à ventiler)',
    reportANouveau: 'Report à nouveau (soldes de départ)',
    dotations: 'Dotations aux amortissements', amortissements: 'Amortissements cumulés', vncCedee: 'Valeur comptable des immobilisations cédées',
    produitsCession: 'Produits des cessions d\'immobilisations', taxesSalaires: 'TFP et FOPROLOS (charge)', tfpFoprolos: 'TFP et FOPROLOS à payer',
    stocks: 'Stocks', variationStocks: 'Variation des stocks',
    subventions: 'Subventions d\'investissement', repriseSubventions: 'Quote-part de subvention reprise',
    pertesChange: 'Pertes de change', gainsChange: 'Gains de change'
  };
  // Un mouvement libre de trésorerie (3.3.0) porte une NATURE ; la 8.9.0 lui donne sa contrepartie.
  // La nature décide par défaut ; un mouvement peut porter son propre `compte` (la TVA du mois
  // réglée en « impôt » va au 4365, pas au 434). Ce que personne ne sait ranger va au compte
  // d'attente : c'est le comptable qui ventile, et c'est écrit.
  const MOVE_ACCOUNTS = {
    salaire: 'personnel', impot: 'impots', banque: 'fraisBancaires', retrait: 'associes', emprunt: 'emprunts',
    'autre-sortie': 'attente', apport: 'associes', pret: 'emprunts', 'autre-entree': 'attente', virement: 'attente'
  };
  // Le RÔLE du compte d'un mouvement, sans contrepartie choisie (10.14.0). Un mouvement « Salaires »
  // RÈGLE ce qu'un bulletin a mis au 425 — mais une entreprise qui ne tient pas la Paie n'a pas de
  // bulletin : son mouvement était écrit « 425 au débit » et son salaire n'entrait dans AUCUNE
  // charge. Le résultat de l'onglet TVA, les états financiers et le paquet du comptable le
  // montraient trop beau du montant des salaires, et le 425 restait débiteur pour toujours. Sans
  // bulletin ce mois-là ni le précédent (un salaire se paie souvent au début du mois suivant), le
  // mouvement EST la charge : il va au 640 — À VÉRIFIER, le comptable ventile le net et les
  // charges. Le mois d'avant, et pas plus loin : créer un bulletin ne réécrit jamais que le mois où
  // il tombe et le suivant.
  function moisAvecBulletin(data) {
    return duLot(data, 'moisAvecBulletin', () => new Set((data.payslips || [])
      .map(s => `${s.year}-${String(s.month).padStart(2, '0')}`)));
  }
  function compteDuMouvement(data, m, bulletins) {
    if (m && m.kind === 'salaire') {
      const mois = String(m.date || '').slice(0, 7);
      const avant = mois ? addMonths(`${mois}-01`, -1).slice(0, 7) : '';
      const b = bulletins || moisAvecBulletin(data);
      if (!b.has(mois) && !b.has(avant)) return 'salairesBruts';
    }
    return MOVE_ACCOUNTS[m && m.kind] || 'attente';
  }
  // Les contreparties qu'un mouvement peut choisir à la main, pour ne pas taper un numéro de compte.
  const COMPTES_CONTREPARTIE = [
    ['', 'Selon la nature du mouvement'], ['4365', 'TVA à payer (déclaration du mois)'], ['4531', 'CNSS'],
    ['4321', 'IRPP retenu sur les salaires'], ['4352', 'Retenue à la source opérée'], ['434', 'Acompte provisionnel'],
    ['431', 'Impôt sur les sociétés'], ['4331', 'TCL'], ['4335', 'TFP et FOPROLOS'], ['627', 'Frais bancaires'],
    ['651', 'Intérêts d\'emprunt'], ['16', 'Emprunt (capital)'], ['4421', 'Compte courant d\'associé'],
    ['775', 'Prix de cession d\'une immobilisation'], ['471', 'À ventiler par le comptable']
  ];
  // Le plan comptable tunisien (Système comptable des entreprises, 1996), classe par classe. Il ne
  // sert qu'à NOMMER un compte à l'écran et dans les exports : le compte 6270 s'appelle « Services
  // bancaires » sans qu'on ait à le déclarer. Un compte s'y retrouve par son plus long préfixe.
  // À VÉRIFIER avec le comptable : les intitulés suivent la nomenclature, chaque cabinet a les siens.
  // Le plan comptable vit dans `compta.js` depuis la 9.8.5 : le Cabinet ne charge pas core.js et a
  // besoin de NOMMER un compte (c'est le défaut T-13 — un compte qui portait le libellé d'une
  // écriture). Réexporté à l'identique ; un test compare les deux par identité d'objet.
  const PLAN_COMPTABLE = Compta.PLAN_COMPTABLE;
  // L'intitulé d'un numéro de compte : d'abord le rôle que l'entreprise lui a donné (plan de comptes
  // réglé), sinon le plan tunisien par le plus long préfixe, sinon « Compte hors plan ». Un compte
  // auxiliaire (411 + code) porte le nom de son tiers, passé en `tiers`.
  function accountLabel(data, account, tiers) {
    const n = String(account || '');
    if (!n) return '';
    const acc = chartAccounts(data);
    const role = Object.keys(acc).find(k => acc[k] === n);
    if (role) return ACCOUNT_LABELS[role] || role;
    if (auxiliairesActifs(data) && tiers && (n.startsWith(acc.clients) || n.startsWith(acc.fournisseurs)) && n.length > Math.max(acc.clients.length, acc.fournisseurs.length)) return tiers;
    let best = null;
    PLAN_COMPTABLE.forEach(([p, l]) => { if (n.startsWith(p) && (!best || p.length > best[0].length)) best = [p, l]; });
    return best ? best[1] : 'Compte hors plan';
  }
  const classeDe = account => String(account || '').charAt(0);
  // Les classes 6 et 7 se remettent à zéro à chaque exercice ; les classes 1 à 5 traversent les années.
  const compteDeGestion = account => classeDe(account) === '6' || classeDe(account) === '7';

  // ---- comptes auxiliaires (8.8.0) : un sous-compte par client et par fournisseur ----
  // 411001, 411002… : c'est ainsi que tous les cabinets tiennent leurs tiers, et c'est ce qui rend
  // possible une balance auxiliaire et un lettrage. Le code d'un tiers est FIGÉ sur sa fiche
  // (`compteAux`) la première fois qu'il est calculé : supprimer un client ne renumérote jamais les
  // autres, sinon le 411004 du comptable désignerait quelqu'un d'autre le mois suivant.
  const auxiliairesActifs = data => !!(data && data.auxiliaires);
  function codesAuxiliaires(liste) {
    const out = {};
    let max = 0;
    (liste || []).forEach(t => { if (t && t.id && t.compteAux) { out[t.id] = String(t.compteAux); max = Math.max(max, Number(t.compteAux) || 0); } });
    (liste || []).forEach(t => { if (t && t.id && !out[t.id]) { max += 1; out[t.id] = String(max).padStart(3, '0'); } });
    return out;
  }
  // Écrit les codes calculés sur les fiches qui n'en ont pas encore. Renvoie le nombre de fiches touchées.
  function numeroterAuxiliaires(data) {
    let n = 0;
    ['clients', 'suppliers'].forEach(k => {
      const codes = codesAuxiliaires(data[k]);
      (data[k] || []).forEach(t => { if (t && t.id && !t.compteAux && codes[t.id]) { t.compteAux = codes[t.id]; n++; } });
    });
    return n;
  }
  // Les journaux : le comptable range ses écritures par nature d'opération.
  const ENTRY_JOURNALS = [
    ['VT', 'Ventes'], ['AC', 'Achats'], ['BQ', 'Banque'], ['CA', 'Caisse'], ['PAIE', 'Paie'], ['OD', 'Opérations diverses'], ['AN', 'À-nouveaux']
  ];
  const journalLabel = code => (ENTRY_JOURNALS.find(j => j[0] === code) || [code, code])[1];

  function chartAccounts(data) {
    return { ...DEFAULT_ACCOUNTS, ...((data && data.chartAccounts) || {}) };
  }

  // Le compte de trésorerie d'un règlement : espèces → caisse, tout le reste → banque.
  const cashAccountFor = (method, acc) => (method === 'espèces' || method === 'especes' || method === 'Espèces') ? acc.caisse : acc.banque;
  // Depuis la 8.9.0 le compte de trésorerie DÉCIDE : un règlement affecté à la caisse va au journal
  // de caisse quel que soit son mode. Sans compte affecté, on retombe sur le mode de paiement.
  // La règle est CELLE de la Trésorerie (`cashMovements`) : le compte affecté, sinon le compte par
  // défaut — le même argent ne peut pas être à la banque sur une page et en caisse sur l'autre.
  // Sans aucun compte de trésorerie, le mode de paiement décide.
  function journalDeCompte(data, acc, accountId, method) {
    const comptes = (data && data.accounts) || [];
    const compte = (accountId && comptes.find(a => a.id === accountId)) || comptes.find(a => a.isDefault) || comptes[0];
    const caisse = compte ? compte.kind === 'caisse' : cashAccountFor(method, acc) === acc.caisse;
    return caisse ? { journal: 'CA', compte: acc.caisse } : { journal: 'BQ', compte: acc.banque };
  }

  // Les écritures d'une période. `opts.auxiliaires` ajoute le nom du tiers en compte auxiliaire ;
  // `opts.sections` permet de n'exporter qu'une partie (ventes, achats, encaissements, paie).
  function journalEntries(data, company, period, opts) {
    // Dans un lot, les écritures d'une même période ne se calculent qu'UNE fois (10.14.0) : le paquet
    // du mois les demandait quatre fois (le journal, la TVA, la balance, le livre-journal) — une
    // seconde et demie par clic sur l'onglet Cabinet avec huit mille pièces. Chaque appelant reçoit
    // SES copies : un appelant qui annote une écriture n'écrit jamais dans celle d'un autre.
    if (lot && data && typeof data === 'object') {
      const cle = 'ecritures@' + JSON.stringify([period || null, opts || null]);
      const parSociete = duLot(data, cle, () => new Map());
      if (!parSociete.has(company)) parSociete.set(company, journalEntriesCalcul(data, company, period, opts));
      return parSociete.get(company).map(e => ({ ...e }));
    }
    return journalEntriesCalcul(data, company, period, opts);
  }
  function journalEntriesCalcul(data, company, period, opts) {
    opts = opts || {};
    const acc = chartAccounts(data);
    const want = s => !opts.sections || opts.sections.indexOf(s) >= 0;
    const out = [];
    const cur = (company && company.currency) || 'DT';
    // Comptes auxiliaires (8.8.0) : 411 + code du client, 401 + code du fournisseur, quand
    // l'entreprise l'a demandé. Les codes viennent des fiches (figés), sinon de l'ordre de la liste.
    const aux = auxiliairesActifs(data);
    const codesC = aux ? codesAuxiliaires(data.clients) : {};
    const codesF = aux ? codesAuxiliaires(data.suppliers) : {};
    const cptClient = id => (aux && id && codesC[id]) ? acc.clients + codesC[id] : acc.clients;
    const cptFourn = id => (aux && id && codesF[id]) ? acc.fournisseurs + codesF[id] : acc.fournisseurs;
    // Lettrage (8.9.0) : une facture soldée et ses règlements portent la même lettre — son numéro.
    // Rien à saisir : les paiements sont déjà rattachés à leur pièce, la lettre en découle.
    const lettreVente = doc => (doc && doc.type === 'facture' && doc.status !== 'annulée' && invoiceBalance(doc, data, company).remaining <= 0.0005) ? doc.number : '';
    const docsById = {}; (data.documents || []).forEach(d => { docsById[d.id] = d; });
    const lettreDoc = id => { const d = docsById[id]; if (!d) return ''; if (d.type === 'avoir') return d.creditOf ? lettreVente(docsById[d.creditOf]) : ''; return lettreVente(d); };
    // La référence d'un achat sans numéro (10.14.1, LET-01) : « SN- » et sa date, jamais son identifiant.
    const refsSN = referencesSansNumeroCalcul(data);
    const refAchat = p => (p && String(p.number || '').trim()) || (p && refsSN[p.id]) || '';
    const lettreAchat = p => (p && purchaseBalance(p, company, data).remaining <= 0.0005 && (p.payments || []).length) ? (refAchat(p) || p.id) : '';
    const achatsById = {}; (data.purchases || []).forEach(p => { achatsById[p.id] = p; });
    const ecartDeTaux = (piece, cible, natif) => ecartDeTauxEntre(piece, cible, natif, company);
    // `delta` a été AJOUTÉ au débit du compte du tiers : la contrepartie équilibre la pièce.
    const ecrireEcartDeChange = (e, delta, label) => {
      if (delta > 0.0005) e.credit(acc.gainsChange, label, delta);
      else if (delta < -0.0005) e.debit(acc.pertesChange, label, -delta);
    };

    // --- ventes : factures et avoirs émis
    if (want('ventes')) {
      salesJournal(data, company, period).forEach(r => {
        // Une facture ANNULÉE (statut enregistré) n'a jamais existé comptablement : `salesJournal`
        // met déjà tous ses montants à zéro, et `entrySet` ignore les lignes nulles. Le test portait
        // avant la 8.9.0 sur le statut EFFECTIF — or une facture entièrement couverte par un avoir
        // s'affiche « annulée » elle aussi : sa facture sautait, son avoir restait, et le client
        // finissait créditeur d'un montant qu'on ne lui avait jamais facturé. C'est le lettrage
        // (reste ouvert ≠ solde du 411) qui l'a attrapé.
        const e = entrySet({ date: r.date, journal: 'VT', piece: r.number, tiers: r.client, tiersId: r.clientId || '', source: 'vente', docId: r.id, currency: cur, lettre: lettreDoc(r.id) });
        // (1.315.0) La facture d'un contrat préparée après coup dit le mois qu'elle couvre, comme le livre du serveur.
        const dP = docsById[r.id], perP = dP && dP.recurringId && /^\d{4}-\d{2}-\d{2}$/.test(dP.periode || '') && dP.periode.slice(0, 7) !== String(dP.date || '').slice(0, 7) ? dP.periode : '';
        const label = `${r.typeLabel} ${r.number}${r.client ? ' — ' + r.client : ''}${perP ? ' · période ' + deLibelle(monthLabel(perP)) : ''}`;
        // Le client est débité du BRUT — ce que la pièce vaut, retenue comprise (10.14.0). La retenue
        // ne naît pas ici : c'est le client qui l'opère en payant, et chaque encaissement le solde
        // de ce qu'il verse plus la part qu'il garde pour l'État (D 4358). À VÉRIFIER avec le
        // comptable : le fait générateur (le paiement) et la constatation.
        // Un avoir rattaché à une facture de même devise mais à un autre taux règle le client au taux
        // de la FACTURE ; l'écart part au change. Son montant est négatif : le montant natif aussi.
        const av = r.type === 'avoir' ? docsById[r.id] : null;
        const ta = av ? computeTotals(av, company) : null;
        // Le brut, c'est le TTC : le net après retenue plus la retenue (un seul arrondi, celui du TTC).
        const deltaChange = av && av.creditOf ? ecartDeTaux(av, docsById[av.creditOf], -ta.totalTTC) : 0;
        e.debit(cptClient(r.clientId), label, round3(r.ttc + deltaChange), { role: 'clients' });
        ecrireEcartDeChange(e, deltaChange, `Écart de change ${r.number}${av && av.creditOfNumber ? ' (au taux de ' + av.creditOfNumber + ')' : ''}`);
        // Un avoir posé APRÈS un encaissement régularise la retenue que le client a déjà gardée, à SA
        // date — jamais en réécrivant l'encaissement d'un mois déjà déclaré.
        if (av && av.creditOf && docsById[av.creditOf]) {
          const f = docsById[av.creditOf];
          const adj = retenueSubie(f, data, company).ajustements[av.id];
          if (adj) {
            const b = toBase(f, adj, company);
            e.debit(acc.rsSubie, `Régularisation de la retenue ${f.number || ''} (avoir ${r.number})`.replace(/\s+/g, ' '), b);
            e.credit(cptClient(r.clientId), label, b, { role: 'clients' });
          }
        }
        const cptVente = estCession(docsById[r.id], data) ? acc.produitsCession : acc.ventes;
        VAT_RATES.forEach(rate => {
          const v = r.vatByRate[rate];
          if (v && v.base) e.credit(cptVente, `${label} (HT ${rate} %)`, v.base, { vatRate: rate });
          if (v && v.vat) e.credit(acc.tvaCollectee, `TVA ${rate} % — ${r.number}`, v.vat, { vatRate: rate });
        });
        if (r.timbre) e.credit(acc.timbre, `Timbre fiscal ${r.number}`, r.timbre);
        if (r.fodec) e.credit(acc.fodec, `FODEC ${r.number}`, r.fodec);
        ecrireEcartDeChange(e, r.ecartConversion || 0, `Écart de conversion ${r.number}`);
        out.push(...e.done());
      });
    }

    // --- achats : factures fournisseurs et dépenses
    if (want('achats')) {
      (data.purchases || [])
        .filter(p => inPeriod(p.date, period && period.from, period && period.to))
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        .forEach(p => {
          const t = purchaseTotals(p, company);
          const sup = ((data.suppliers || []).find(s => s.id === p.supplierId) || {}).name || '';
          const num = p.number || '(sans numéro)';
          const piece = refAchat(p);
          const e = entrySet({ date: p.date, journal: 'AC', piece, tiers: sup, tiersId: p.supplierId || '', source: 'achat', docId: p.id, currency: cur, lettre: lettreAchat(p) });
          const NATURE = { depense: 'Dépense', avoir: 'Avoir fournisseur', acompte: 'Acompte versé' };
          const label = `${NATURE[p.kind] || 'Achat'} ${num}${sup ? ' — ' + sup : ''}`;
          // Un acompte versé n'est pas une charge : c'est une créance sur le fournisseur tant qu'il
          // n'a pas livré (10.2.0). Il va donc aux avances, quelle que soit la destination des
          // lignes — et c'est l'imputation, plus bas, qui le solde le jour de la facture.
          // L'avoir, lui, garde les comptes de la facture : ses montants `base` sont NÉGATIFS et
          // `entrySet` change la colonne tout seul (règle 6.3.0).
          const dest = { charge: acc.charges, stock: acc.achatsStock, immobilisation: acc.immobilisations };
          // Tout ce qui entre dans un LIVRE est en devise de base (10.1.0) : une écriture porte la
          // devise de la comptabilité, jamais celle de la facture du fournisseur. Le montant
          // d'origine reste sur la pièce, et c'est elle qu'on rouvre pour le lire.
          if (t.base.avance) e.debit(acc.avancesFournisseurs, label, t.base.avance);
          Object.keys(t.base.byDestination).forEach(k => {
            if (t.base.byDestination[k]) e.debit(dest[k] || acc.charges, `${label} (${k})`, t.base.byDestination[k], { destination: k });
          });
          if (t.base.fees) e.debit(acc.fraisAccessoires, `Frais accessoires ${num}`, t.base.fees);
          if (t.base.deductibleVAT) e.debit(acc.tvaDeductible, `TVA déductible ${num}`, t.base.deductibleVAT);
          // TVA non déductible : elle n'est pas récupérable, elle grossit le COÛT de ce qu'elle a
          // payé — la charge, le stock ou le bien immobilisé (10.14.0 ; avant, toujours la charge,
          // et une voiture de tourisme passait sa TVA en frais l'année de l'achat au lieu de
          // l'amortir). Sur un acompte, elle reste dans l'avance, que l'imputation reprend entière.
          if (p.kind === 'acompte') {
            const nonDeductible = round3(t.base.totalVAT - t.base.deductibleVAT);
            if (nonDeductible) e.debit(acc.avancesFournisseurs, `TVA non déductible ${num}`, nonDeductible);
          } else {
            Object.keys(t.base.nonDeductibleParDestination).forEach(k => {
              const nd = t.base.nonDeductibleParDestination[k];
              if (nd) e.debit(dest[k] || acc.charges, `TVA non déductible ${num}`, nd, { destination: k });
            });
          }
          // La retenue à la source ne naît PAS ici (10.14.0) : elle s'opère au règlement, qui la
          // crédite au 4352 le jour où l'argent part. Le fournisseur est donc crédité du BRUT —
          // ce que la pièce lui doit —, et chaque règlement le débite de ce qu'il lui verse plus
          // la part de retenue qu'il garde pour l'État.
          // Un avoir IMPUTÉ sur une facture de même devise à un autre taux règle le fournisseur au
          // taux de la facture, pour la part qu'il déduit (ce que le fournisseur a remboursé est
          // sorti de son compte au taux de l'avoir, par le règlement) ; l'écart part au change.
          let deltaChange = 0;
          if (p.kind === 'avoir' && p.achatLie && achatsById[p.achatLie]) {
            deltaChange = ecartDeTaux(p, achatsById[p.achatLie], imputationAchat(p, company).brut);
          }
          e.credit(cptFourn(p.supplierId), label, round3(t.base.netToPay + t.base.withholding - deltaChange), { role: 'fournisseurs' });
          ecrireEcartDeChange(e, deltaChange, `Écart de change ${num} (au taux de ${achatsById[p.achatLie] ? (achatsById[p.achatLie].number || 'la facture') : 'la facture'})`);
          // Un avoir posé APRÈS un règlement régularise la retenue déjà opérée sur sa facture, à SA
          // date (10.14.0) — jamais en réécrivant le règlement d'un mois déjà déclaré. Positive, elle
          // s'opère comme au règlement (C 4352 / D 401) ; négative, les colonnes s'inversent seules.
          if (p.kind === 'avoir' && p.achatLie && achatsById[p.achatLie]) {
            const f = achatsById[p.achatLie];
            const adj = retenueDesReglements(f, company, data).ajustements[p.id];
            if (adj) {
              const b = toBase(f, adj, company);
              e.credit(acc.rsOperee, `Régularisation de la retenue ${f.number || ''} (avoir ${num})`.replace(/\s+/g, ' '), b);
              e.debit(cptFourn(p.supplierId), label, b, { role: 'fournisseurs' });
            }
          }
          out.push(...e.done());

          // L'IMPUTATION DE L'ACOMPTE (10.2.0). L'acompte a posé une avance au 409 et l'a réglée ;
          // la facture crédite le fournisseur de son total. Sans cette pièce, le 401 resterait
          // débiteur de l'acompte et le 409 débiteur pour toujours : deux comptes faux qui
          // s'annulent au bilan sans jamais se solder, donc que personne ne voit passer.
          // Un AVOIR n'en a pas besoin : ses montants `base` sont négatifs, donc son écriture
          // débite déjà le fournisseur — il ne reste qu'à lettrer.
          if (p.kind !== 'avoir' && p.kind !== 'acompte') {
            piecesLieesAchat(data, p.id, 'acompte').forEach(a => {
              const ta = purchaseTotals(a, company);
              // L'imputation REPREND ce que l'acompte avait posé, ligne par ligne, et recrédite le
              // fournisseur. La TVA en fait partie : celle de la facture porte sur le montant
              // ENTIER, acompte compris, donc la garder des deux côtés la déduirait deux fois.
              const im = entrySet({ date: p.date, journal: 'OD', piece, tiers: sup, tiersId: p.supplierId || '', source: 'achat', docId: p.id, currency: cur });
              const lbl = `Imputation acompte ${a.number || ''} sur ${num}`.replace('  ', ' ');
              // Au taux de la FACTURE (10.14.0) : un acompte payé à 3,30 sur une facture à 3,35 règle
              // 100 € de la dette, que le 401 porte à 3,35 ; l'écart part au change.
              // Le BRUT de l'acompte (10.14.0) : sa retenue a été opérée quand il a été versé, et
              // la facture n'en opérera que le reste.
              const deltaChange = ecartDeTaux(a, p, round3(ta.netToPay + ta.withholding));
              im.debit(cptFourn(p.supplierId), lbl, round3(ta.base.netToPay + ta.base.withholding + deltaChange), { role: 'fournisseurs' });
              ecrireEcartDeChange(im, deltaChange, `Écart de change ${a.number || ''} (au taux de ${num})`.replace('  ', ' '));
              const avance = round3(ta.base.totalTTC - ta.base.deductibleVAT);
              if (avance) im.credit(acc.avancesFournisseurs, lbl, avance);
              if (ta.base.deductibleVAT) im.credit(acc.tvaDeductible, lbl, ta.base.deductibleVAT);
              out.push(...im.done());
            });
          }
        });
    }

    // --- encaissements clients
    if (want('encaissements')) {
      paymentsJournal(data, company, period).forEach(r => {
        const j = journalDeCompte(data, acc, r.accountId, r.method);
        const e = entrySet({ date: r.date, journal: j.journal, piece: r.number || '', tiers: r.client, tiersId: r.clientId || '', source: 'encaissement', docId: r.docId, currency: cur, lettre: lettreDoc(r.docId) });
        const label = `${r.remboursement ? 'Remboursement' : 'Règlement'} ${r.number || ''}${r.client ? ' — ' + r.client : ''}${r.reference ? ' (' + r.reference + ')' : ''}`;
        e.debit(j.compte, label, r.amount);
        // Le client est soldé de ce qu'il verse ET de la retenue qu'il garde pour l'État : c'est ici,
        // à l'encaissement, que la retenue subie naît (10.14.0).
        e.credit(cptClient(r.clientId), label, round3(r.amountTiers + (r.rs || 0)), { role: 'clients' });
        if (r.rs) e.debit(acc.rsSubie, `Retenue à la source subie ${r.number || ''}`.trim(), r.rs);
        // Le client se solde au taux de SA facture ; la banque a reçu au taux du jour (10.14.0).
        const ecart = round3(r.amount - r.amountTiers);
        if (ecart > 0) e.credit(acc.gainsChange, `Gain de change — ${label}`, ecart);
        else if (ecart < 0) e.debit(acc.pertesChange, `Perte de change — ${label}`, -ecart);
        out.push(...e.done());
      });
    }

    // --- règlements fournisseurs
    if (want('reglements')) {
      supplierPayments(data, company, period).forEach(r => {
        const j = journalDeCompte(data, acc, r.accountId, r.method);
        const e = entrySet({ date: r.date, journal: j.journal, piece: refAchat(achatsById[r.purchaseId]) || r.number || '', tiers: r.supplier, tiersId: r.supplierId || '', source: 'règlement', docId: r.purchaseId, currency: cur, lettre: lettreAchat(achatsById[r.purchaseId]) });
        const label = `Règlement fournisseur ${r.number || ''}${r.supplier ? ' — ' + r.supplier : ''}`;
        // Le fournisseur est soldé de ce qu'on lui verse ET de la retenue qu'on garde pour l'État :
        // c'est ici, au paiement, que la retenue à la source naît (10.14.0).
        e.debit(cptFourn(r.supplierId), label, round3(r.amountTiers + (r.rs || 0)), { role: 'fournisseurs' });
        e.credit(j.compte, label, r.amount);
        if (r.rs) e.credit(acc.rsOperee, `Retenue à la source opérée ${r.number || ''}`.trim(), r.rs);
        // Payer plus de dinars que la pièce n'en porte est une perte de change (10.14.0).
        const ecart = round3(r.amount - r.amountTiers);
        if (ecart > 0) e.debit(acc.pertesChange, `Perte de change — ${label}`, ecart);
        else if (ecart < 0) e.credit(acc.gainsChange, `Gain de change — ${label}`, -ecart);
        out.push(...e.done());
      });
    }

    // --- 8.9.0 : les soldes de départ des comptes de trésorerie. Sans eux, la banque du grand livre
    // ne dirait jamais le même chiffre que la page Trésorerie. La contrepartie va au report à
    // nouveau — c'est au comptable de dire ce que ce solde représentait (capital, résultats passés).
    if (want('ouverture')) {
      (data.accounts || []).forEach(a => {
        const montant = round3(Number(a.opening) || 0);
        if (!montant || !a.openingDate || !inPeriod(a.openingDate, period && period.from, period && period.to)) return;
        const e = entrySet({ date: a.openingDate, journal: 'AN', piece: 'OUVERTURE', tiers: '', tiersId: '', source: 'ouverture', docId: a.id, currency: cur });
        const compte = a.kind === 'caisse' ? acc.caisse : acc.banque;
        e.debit(compte, `Solde de départ — ${a.name || 'compte'}`, montant);
        e.credit(acc.reportANouveau, `Solde de départ — ${a.name || 'compte'}`, montant);
        out.push(...e.done());
      });
      // Le stock de départ des articles (10.14.0) : de la marchandise déjà là avant les premiers
      // achats enregistrés. Elle entre au bilan contre le report à nouveau, jamais au résultat.
      inventaireComptable(data, opts.todayIso).departs.forEach(x => {
        if (!inPeriod(x.date, period && period.from, period && period.to)) return;
        const e = entrySet({ date: x.date, journal: 'AN', piece: 'OUVERTURE-STOCK', tiers: '', tiersId: '', source: 'ouverture', docId: 'stock-' + x.date, currency: cur });
        e.debit(acc.stocks, 'Stock de départ des articles', x.montant);
        e.credit(acc.reportANouveau, 'Stock de départ des articles', x.montant);
        out.push(...e.done());
      });
      // Le crédit de TVA saisi à la main pour une année (3.1.0) : la déclaration de janvier le
      // reprend, donc le compte 4366 doit le porter, sinon il finirait créditeur de ce montant.
      // Seulement pour une année dont SkanFact ne connaît pas l'année d'avant (10.14.0) : sinon le
      // report est CALCULÉ, et le 4366 le porte déjà par ses à-nouveaux — l'écrire ici le doublerait.
      Object.keys(data.vatCarryIn || {}).forEach(y => {
        const montant = round3(Number(data.vatCarryIn[y]) || 0);
        const d = `${y}-01-01`;
        if (!montant || !/^\d{4}$/.test(y) || !inPeriod(d, period && period.from, period && period.to)) return;
        if (reportTvaDebut(data, company, y).source !== 'saisi') return;
        const e = entrySet({ date: d, journal: 'AN', piece: `OUVERTURE-TVA-${y}`, tiers: '', tiersId: '', source: 'ouverture', docId: 'tva-' + y, currency: cur });
        e.debit(acc.tvaDeductible, `Crédit de TVA reporté de ${Number(y) - 1}`, montant);
        e.credit(acc.reportANouveau, `Crédit de TVA reporté de ${Number(y) - 1}`, montant);
        out.push(...e.done());
      });
    }

    // --- 8.9.0 : les mouvements libres de trésorerie. Un salaire réglé, un impôt payé, un apport,
    // des frais bancaires : ils sortaient de la banque sur la page Trésorerie et n'existaient dans
    // aucune écriture — la banque du grand livre était fausse de ce montant-là.
    if (want('tresorerie')) {
      const bulletins = moisAvecBulletin(data);
      (data.movements || []).forEach(m => {
        const montant = round3(Math.abs(Number(m.amount) || 0));
        if (!montant || !inPeriod(m.date, period && period.from, period && period.to)) return;
        const nature = (MOVE_KINDS.find(k => k[0] === m.kind) || [null, 'Mouvement'])[1];
        // Un virement entre deux comptes de l'entreprise (10.14.0) : le compte d'arrivée EST la
        // contrepartie — une banque qui alimente la caisse s'écrit 54 au débit, 532 au crédit. Un côté
        // supprimé (10.14.1) laisse l'autre à ce que son relevé dit, contre le compte d'attente.
        const cotes = virementCotes(data, m);
        if (cotes && cotes.neutre) return;
        const nomDe = id => ((data.accounts || []).find(a => a.id === id) || {}).name || 'un autre compte';
        if (cotes && !cotes.depart && cotes.vers) {
          const jv = journalDeCompte(data, acc, cotes.vers, m.method);
          const e = entrySet({ date: m.date, journal: jv.journal, piece: m.reference || nature, tiers: '', tiersId: '', source: 'mouvement', docId: m.id, currency: cur });
          const label = m.label || `Virement vers ${nomDe(cotes.vers)} (compte de départ supprimé)`;
          e.debit(jv.compte, label, montant); e.credit(acc.attente, label, montant);
          out.push(...e.done());
          return;
        }
        const j = journalDeCompte(data, acc, cotes ? cotes.depart : m.accountId, m.method);
        const vers = cotes ? cotes.vers : '';
        const contrepartie = vers ? journalDeCompte(data, acc, vers, m.method).compte
          : (m.kind !== 'virement' && String(m.compte || '').trim()) || acc[compteDuMouvement(data, m, bulletins)];
        const e = entrySet({ date: m.date, journal: j.journal, piece: m.reference || nature, tiers: '', tiersId: '', source: 'mouvement', docId: m.id, currency: cur });
        const label = m.label || (vers ? `Virement vers ${nomDe(vers)}` : nature);
        if (moveSign(m.kind) > 0) { e.debit(j.compte, label, montant); e.credit(contrepartie, label, montant); }
        else { e.debit(contrepartie, label, montant); e.credit(j.compte, label, montant); }
        out.push(...e.done());
      });
    }

    // --- paie : un bulletin = une écriture, avec la copie du calcul remise au salarié
    if (want('paie')) {
      (data.payslips || [])
        .filter(s => inPeriod(payslipDate(s), period && period.from, period && period.to))
        .forEach(s => {
          const emp = (data.employees || []).find(x => x.id === s.employeeId) || {};
          const c = s.computed || computePayslip(emp, s, payrollSettings(data));
          const d = payslipDate(s);
          const e = entrySet({ date: d, journal: 'PAIE', piece: `PAIE-${s.year}-${String(s.month).padStart(2, '0')}`, tiers: emp.name || '', source: 'bulletin', docId: s.id, currency: cur });
          const label = `Salaire ${emp.name || ''} ${MONTHS_FR[Number(s.month) - 1] || ''} ${s.year}`;
          e.debit(acc.salairesBruts, label, c.gross);
          e.debit(acc.chargesPatronales, `Charges patronales — ${emp.name || ''}`, round3(c.cnssEmployer + c.accident));
          // 9.0.0 : TFP et FOPROLOS, une charge (661) et une dette envers l'État (4335) — sur la
          // copie figée du bulletin : un bulletin d'avant n'en porte pas, et n'en gagne pas.
          e.debit(acc.taxesSalaires, `TFP et FOPROLOS — ${emp.name || ''}`, round3((c.tfp || 0) + (c.foprolos || 0)));
          e.credit(acc.tfpFoprolos, `TFP et FOPROLOS à payer — ${emp.name || ''}`, round3((c.tfp || 0) + (c.foprolos || 0)));
          e.credit(acc.cnss, `CNSS — ${emp.name || ''}`, round3(c.cnssEmployee + c.cnssEmployer + c.accident));
          e.credit(acc.irpp, `IRPP et contribution sociale — ${emp.name || ''}`, round3(c.irpp + c.css));
          // Les retenues diverses (remboursement d'avance) restent dues à l'entreprise : elles
          // diminuent le net versé. À VÉRIFIER : compte d'avance au personnel si le cabinet en tient un.
          e.credit(acc.personnel, label, round3(c.net + c.otherDeductions));
          out.push(...e.done());
        });
      // 8.9.0 : le bulletin RÉGLÉ. La dette envers le salarié s'éteint, l'argent sort — c'est le
      // mouvement que la Trésorerie montrait depuis la 5.0.0 sans qu'aucune écriture ne le porte.
      (data.payslips || [])
        .filter(s => s.paidDate && inPeriod(s.paidDate, period && period.from, period && period.to))
        .forEach(s => {
          const emp = (data.employees || []).find(x => x.id === s.employeeId) || {};
          const net = round3(((s.computed || {}).net) || 0);
          if (!net) return;
          const j = journalDeCompte(data, acc, s.accountId, s.method);
          const e = entrySet({ date: s.paidDate, journal: j.journal, piece: `PAIE-${s.year}-${String(s.month).padStart(2, '0')}`, tiers: emp.name || '', tiersId: '', source: 'salaire', docId: s.id, currency: cur });
          const label = `Paiement salaire ${emp.name || ''} ${MONTHS_FR[Number(s.month) - 1] || ''} ${s.year}`;
          e.debit(acc.personnel, label, net);
          e.credit(j.compte, label, net);
          out.push(...e.done());
        });
      // 10.14.0 : l'AVANCE versée. Elle débite le 425 : les retenues des bulletins suivants (portées
      // au crédit avec le net, plus haut) la soldent mois après mois, et le 425 revient à ce qui est
      // encore dû. Sans elle, le 425 gardait les retenues pour toujours et la banque ne voyait
      // jamais partir l'argent. À VÉRIFIER : un compte d'avances au personnel distinct si le
      // cabinet en tient un.
      (data.advances || [])
        .filter(a => inPeriod(a.date, period && period.from, period && period.to))
        .forEach(a => {
          const montant = round3(Number(a.amount) || 0);
          if (!montant) return;
          const emp = (data.employees || []).find(x => x.id === a.employeeId) || {};
          const j = journalDeCompte(data, acc, a.accountId, a.method);
          const e = entrySet({ date: a.date, journal: j.journal, piece: `AVANCE-${a.date || ''}`, tiers: emp.name || '', tiersId: '', source: 'avance', docId: a.id, currency: cur });
          const label = `Avance sur salaire ${emp.name || ''}`.trim();
          e.debit(acc.personnel, label, montant);
          e.credit(j.compte, label, montant);
          out.push(...e.done());
        });
      // (plateforme) 1.228.0 — la déclaration sociale PAYÉE éteint la dette que les bulletins ont créée : la CNSS du
      // trimestre débite le compte de la CNSS ; les retenues et taxes d'un mois débitent l'IRPP et la solidarité d'un côté,
      // la TFP et le FOPROLOS de l'autre, selon les parts figées au paiement. La banque (ou la caisse) au crédit : le même
      // montant que la ligne de trésorerie (deux chemins, un chiffre).
      (data.socialFilings || [])
        .filter(f => f.paidDate && Number(f.amount) && inPeriod(f.paidDate, period && period.from, period && period.to))
        .forEach(f => {
          const montant = round3(Number(f.amount) || 0);
          const j = journalDeCompte(data, acc, f.accountId, f.method);
          const cnss = /^cnss-/.test(f.id);
          const e = entrySet({ date: f.paidDate, journal: j.journal, piece: String(f.id).toUpperCase(), tiers: cnss ? 'CNSS' : 'Recette des finances', tiersId: '', source: 'social', docId: f.id, currency: cur });
          const label = f.label || 'Déclaration sociale';
          if (cnss) e.debit(acc.cnss, label, montant);
          else {
            const parts = f.parts && typeof f.parts === 'object' ? f.parts : {};
            const tfp = round3(Math.min(montant, Number(parts.tfp) || 0));
            if (tfp) e.debit(acc.tfpFoprolos, `${label} — TFP et FOPROLOS`, tfp);
            if (round3(montant - tfp)) e.debit(acc.irpp, `${label} — IRPP et solidarité`, round3(montant - tfp));
          }
          e.credit(j.compte, label, montant);
          out.push(...e.done());
        });
      // (plateforme) 1.230.0 — le VERSEMENT au créancier d'une saisie sur salaire. Le bulletin a porté la retenue au crédit
      // du 425 avec le net ; le versement l'en retire, et la banque (ou la caisse) bouge comme la ligne de trésorerie.
      // À VÉRIFIER avec le comptable : un compte d'oppositions sur salaires distinct du 425 si le cabinet en tient un.
      (data.employees || []).forEach(emp => (Array.isArray(emp.saisies) ? emp.saisies : []).forEach(x => (x.versements || [])
        .filter(v => v.date && Number(v.amount) && inPeriod(v.date, period && period.from, period && period.to))
        .forEach(v => {
          const montant = round3(Number(v.amount) || 0);
          const j = journalDeCompte(data, acc, v.accountId, v.method);
          const e = entrySet({ date: v.date, journal: j.journal, piece: `SAISIE-${v.date}`, tiers: String(x.creancier || '').trim() || 'Créancier', tiersId: '', source: 'saisie', docId: x.id, currency: cur });
          const label = `Saisie sur salaire ${emp.name || ''}`.trim();
          e.debit(acc.personnel, label, montant);
          e.credit(j.compte, label, montant);
          out.push(...e.done());
        })));
    }

    // --- 8.9.0 : la déclaration mensuelle. À la fin de chaque mois écoulé, la TVA collectée se
    // solde contre la déductible (report compris), et le net à payer — timbres et retenues opérées
    // avec lui, c'est le même formulaire — va au 4365. Un crédit reste au débit du 4366 : c'est lui
    // que la déclaration suivante reprend, exactement comme `vatChain`.
    if (want('declarations')) {
      const t = opts.todayIso || today();
      const annees = new Set();
      const noter = d => { if (d && /^\d{4}/.test(d)) annees.add(d.slice(0, 4)); };
      (data.documents || []).forEach(d => noter(d.date)); (data.purchases || []).forEach(p => noter(p.date));
      // Seules les années que la période touche : calculer les autres ne servait qu'à jeter leurs
      // écritures — soixante-douze déclarations pour en garder une (10.14.0). Le report de l'année
      // d'avant, lui, vient de `reportTvaDebut`, qui ne rend qu'un chiffre.
      const y0 = period && period.from ? period.from.slice(0, 4) : '', y1 = period && period.to ? period.to.slice(0, 4) : '';
      [...annees].sort().filter(y => (!y0 || y >= y0) && (!y1 || y <= y1)).forEach(y => {
        vatChain(data, company, y).forEach(m => {
          const dernier = `${m.month}-${pad2(daysInMonth(Number(y), Number(m.month.slice(5, 7))))}`;
          if (dernier >= t || !inPeriod(dernier, period && period.from, period && period.to)) return;
          // Un mois dont la seule pièce est un avoir fournisseur n'a rien collecté, et pourtant il
          // DOIT (10.14.1) : l'avoir reprend de la TVA déjà déduite (déductible négative), la chaîne
          // annonce une TVA à reverser, et sans cette écriture le 4366 restait créditeur pour
          // toujours pendant que le 4365 ignorait ce qu'on devait.
          if (!m.collected && !m.stamps && !m.withheldOnBuys && !m.toPay) return;
          const e = entrySet({ date: dernier, journal: 'OD', piece: `TVA-${m.month}`, tiers: '', tiersId: '', source: 'declaration', docId: 'tva-' + m.month, currency: cur });
          const label = `Déclaration mensuelle ${m.label} ${y}`;
          e.debit(acc.tvaCollectee, `TVA collectée — ${label}`, m.collected);
          e.debit(acc.timbre, `Timbres fiscaux — ${label}`, m.stamps);
          e.debit(acc.rsOperee, `Retenues à la source opérées — ${label}`, m.withheldOnBuys);
          e.credit(acc.tvaDeductible, `TVA déductible imputée — ${label}`, round3(m.collected - m.toPay));
          e.credit(acc.tvaAPayer, `Net à payer — ${label}`, round3(m.toPay + m.stamps + m.withheldOnBuys));
          out.push(...e.done());
        });
      });
    }

    // --- 8.9.0 : les opérations diverses saisies à la main. Le comptable les demandait en
    // premier ; elles sont enregistrées telles quelles, après avoir été refusées si elles ne
    // tombaient pas juste (`odValide`).
    if (want('od')) {
      (data.ecrituresOD || [])
        .filter(od => inPeriod(od.date, period && period.from, period && period.to))
        .forEach(od => {
          const e = entrySet({ date: od.date, journal: od.journal || 'OD', piece: od.piece || '', tiers: '', tiersId: '', source: 'od', docId: od.id, currency: cur });
          (od.lignes || []).forEach(l => {
            if (Number(l.debit) > 0) e.debit(l.compte, l.label || od.label || '', Number(l.debit), { tiers: l.tiers || '' });
            if (Number(l.credit) > 0) e.credit(l.compte, l.label || od.label || '', Number(l.credit), { tiers: l.tiers || '' });
          });
          out.push(...e.done());
        });
    }

    // --- 9.0.0 : les immobilisations. La dotation de chaque exercice s'écrit au 31 décembre (ou au
    // jour de la sortie), jamais avant : c'est une écriture d'inventaire. Un bien saisi à la main
    // (acheté avant SkanFact) entre à sa valeur brute contre le report à nouveau, sinon le 28
    // s'amortirait sur un 22 qui n'existe pas. Une cession sort le bien : l'amortissement cumulé
    // et la valeur nette comptable s'annulent contre la valeur brute ; le PRIX, lui, arrive par la
    // facture ou par un mouvement « autre entrée » avec la contrepartie 775.
    if (want('amortissements')) {
      const t = opts.todayIso || today();
      (data.assets || []).forEach(a => {
        const brut = round3(Number(a.amount) || 0);
        if (!brut || !a.date) return;
        if (!a.purchaseId && inPeriod(a.date, period && period.from, period && period.to)) {
          const e = entrySet({ date: a.date, journal: 'OD', piece: 'IMMO', tiers: '', tiersId: '', source: 'immobilisation', docId: a.id, currency: cur });
          e.debit(acc.immobilisations, `Entrée — ${a.label || 'immobilisation'} (saisie à la main)`, brut);
          e.credit(acc.reportANouveau, `Entrée — ${a.label || 'immobilisation'} (saisie à la main)`, brut);
          out.push(...e.done());
        }
        const dis = a.disposal && a.disposal.date ? a.disposal.date : '';
        assetSchedule(a).forEach(r => {
          if (dis && Number(dis.slice(0, 4)) < r.year) return;
          const d = dis && Number(dis.slice(0, 4)) === r.year ? dis : `${r.year}-12-31`;
          const annuity = dis && Number(dis.slice(0, 4)) === r.year ? assetYear(a, r.year).annuity : r.annuity;
          if (!annuity || d >= t || !inPeriod(d, period && period.from, period && period.to)) return;
          const e = entrySet({ date: d, journal: 'OD', piece: `AMORT-${r.year}`, tiers: '', tiersId: '', source: 'amortissement', docId: a.id, currency: cur });
          e.debit(acc.dotations, `Dotation ${r.year} — ${a.label || ''}`, annuity);
          e.credit(acc.amortissements, `Amortissement ${r.year} — ${a.label || ''}`, annuity);
          out.push(...e.done());
        });
        if (dis && dis < t && inPeriod(dis, period && period.from, period && period.to)) {
          const cumul = assetCumulated(a, dis);
          const e = entrySet({ date: dis, journal: 'OD', piece: 'CESSION', tiers: '', tiersId: '', source: 'cession', docId: a.id, currency: cur });
          e.debit(acc.amortissements, `Sortie — ${a.label || ''} : amortissements repris`, cumul);
          e.debit(acc.vncCedee, `Sortie — ${a.label || ''} : valeur nette comptable`, round3(brut - cumul));
          e.credit(acc.immobilisations, `Sortie — ${a.label || ''} : valeur brute`, brut);
          out.push(...e.done());
        }
      });
    }

    // --- 10.14.0 : l'inventaire du 31 décembre. Une écriture d'inventaire, comme la dotation :
    // au 31 décembre d'un exercice TERMINÉ, jamais avant (voir `inventaireComptable`).
    if (want('inventaire')) {
      inventaireComptable(data, opts.todayIso).variations.forEach(v => {
        if (!inPeriod(v.date, period && period.from, period && period.to)) return;
        const e = entrySet({ date: v.date, journal: 'OD', piece: `INVENTAIRE-${v.annee}`, tiers: '', tiersId: '', source: 'inventaire', docId: 'inv-' + v.annee, currency: cur });
        const lib = `Stock au 31/12/${v.annee} : ${money(v.valeur)}`;
        if (v.montant > 0) { e.debit(acc.stocks, lib, v.montant); e.credit(acc.variationStocks, `Variation des stocks ${v.annee}`, v.montant); }
        else { e.debit(acc.variationStocks, `Variation des stocks ${v.annee}`, -v.montant); e.credit(acc.stocks, lib, -v.montant); }
        out.push(...e.done());
      });
    }

    // --- 9.0.0 : les à-nouveaux. Au 1er janvier de chaque exercice, une pièce AN rouvre chaque
    // compte de bilan avec son solde de la veille, et porte au compte de résultat le net des
    // charges et produits de TOUT ce qui précède — c'est ainsi que les classes 6 et 7 repartent de
    // zéro. Elle se calcule sur les écritures réelles seules (jamais sur les AN précédentes) : le
    // solde d'un compte de bilan persiste, celui des comptes de gestion se cumule au résultat.
    if (want('anouveaux')) {
      const dates = [];
      const noter = d => { if (d && /^\d{4}-\d{2}-\d{2}/.test(d)) dates.push(d.slice(0, 10)); };
      (data.documents || []).forEach(d => noter(d.date)); (data.purchases || []).forEach(p => noter(p.date));
      (data.movements || []).forEach(m => noter(m.date)); (data.accounts || []).forEach(a => noter(a.openingDate));
      (data.assets || []).forEach(a => noter(a.date)); (data.payslips || []).forEach(s => noter(payslipDate(s)));
      (data.ecrituresOD || []).forEach(o => noter(o.date));
      if (dates.length) {
        const premiere = Number(dates.sort()[0].slice(0, 4));
        const derniere = Number(String((period && period.to) || (opts.todayIso || today())).slice(0, 4));
        const sansAN = SECTIONS_ECRITURES.filter(s => s !== 'anouveaux');
        for (let y = premiere + 1; y <= derniere; y++) {
          const d = `${y}-01-01`;
          if (!inPeriod(d, period && period.from, period && period.to)) continue;
          const reelles = journalEntries(data, company, { from: '', to: `${y - 1}-12-31` }, { ...opts, sections: sansAN });
          const soldes = {};
          // 10.14.0 — les comptes de TIERS rouvrent pièce par pièce (« à-nouveaux détaillés »). Un
          // seul solde global du 411 perdait le fil : une facture de décembre réglée en janvier
          // arrivait dans l'exercice suivant par son seul règlement, lettré à une facture que
          // l'exercice ne voyait plus. Le lettrage le comptait réglé pendant que le compte le
          // comptait dû — « le reste ouvert n'est pas le solde du compte », et un « lettrage faux »
          // accusé sur une saisie juste. C'est l'exemple sur cinq ans qui l'a montré : sur treize
          // mois, aucune facture ne traversait un 31 décembre. Chaque ligne rouvre avec son tiers,
          // son rôle et sa LETTRE ; le total par compte ne change pas d'un millime.
          const tiersSoldes = {};
          let net = 0;
          reelles.forEach(e => {
            const v = round3(e.debit - e.credit);
            if (compteDeGestion(e.account)) net = round3(net + v);
            else if (e.role === 'clients' || e.role === 'fournisseurs') {
              // Une pièce lettrée rouvre seule, avec sa lettre ; le non-lettré se résume par tiers
              // (la même règle que le Cabinet, `Compta.anouveauxDe`).
              const k = `${e.account}|${e.role}|${e.tiersId || e.tiers || ''}|${e.lettre ? 'L:' + e.lettre : 'N'}`;
              const t = tiersSoldes[k] = tiersSoldes[k] || { account: e.account, role: e.role, tiersId: e.tiersId || '', tiers: e.tiers || '', lettre: e.lettre || '', piece: e.lettre ? (e.piece || '') : '', v: 0 };
              t.v = round3(t.v + v);
            } else soldes[e.account] = round3((soldes[e.account] || 0) + v);
          });
          const e = entrySet({ date: d, journal: 'AN', piece: `AN-${y}`, tiers: '', tiersId: '', source: 'anouveau', docId: 'an-' + y, currency: cur });
          Object.keys(soldes).sort().forEach(k => {
            if (!soldes[k]) return;
            const label = `À-nouveau ${y} — ${accountLabel(data, k)}`;
            if (soldes[k] > 0) e.debit(k, label, soldes[k]); else e.credit(k, label, -soldes[k]);
          });
          Object.keys(tiersSoldes).sort().forEach(k => {
            const t = tiersSoldes[k];
            if (!t.v) return;
            const label = `À-nouveau ${y} — ${t.tiers || accountLabel(data, t.account)} — ${t.lettre ? (t.piece || t.lettre) : 'non lettré'}`;
            const extra = { role: t.role, tiersId: t.tiersId, tiers: t.tiers, lettre: t.lettre };
            if (t.v > 0) e.debit(t.account, label, t.v, extra); else e.credit(t.account, label, -t.v, extra);
          });
          // Un net positif = les charges dépassent les produits : une perte, au débit du résultat.
          if (net > 0) e.debit(acc.resultat, `Résultat des exercices antérieurs (perte)`, net);
          else if (net < 0) e.credit(acc.resultat, `Résultat des exercices antérieurs (bénéfice)`, -net);
          out.push(...e.done());
        }
      }
    }

    return out.sort((a, b) => (a.date || '').localeCompare(b.date || '')
      || (a.journal || '').localeCompare(b.journal || '')
      || TRI_NUMERIQUE.compare((a.piece || ''), b.piece || ''));
  }
  const SECTIONS_ECRITURES = ['ventes', 'achats', 'encaissements', 'reglements', 'ouverture', 'tresorerie', 'paie', 'declarations', 'od', 'amortissements', 'inventaire', 'anouveaux'];

  // Le contrôle qu'un comptable fait en premier : est-ce que ça tombe juste ? Pièce par pièce, et
  // en tout. Une pièce déséquilibrée serait refusée à l'import de son logiciel.
  // L'équilibre d'un jeu d'écritures, et la balance par compte. Les deux vivent dans `compta.js`
  // depuis la 9.1.0 : elles ne prennent que des LIGNES, donc elles servent aussi au cabinet, qui
  // n'a pas de `data`. Réexportées ici à l'identique — aucun appelant n'a changé.
  const entriesBalance = Compta.entriesBalance;
  // 9.8.0 — le dossier de clôture reçu du cabinet se valide avec la MÊME fonction que celle qui l'a
  // écrit : deux lectures du même format finiraient par ne plus accepter la même chose.
  const clotureValide = Compta.clotureValide;
  const entriesByAccount = Compta.entriesByAccount;

  const entryCsvColumns = () => ([
    { key: 'numero', label: 'N°' },
    { key: 'date', label: 'Date', type: 'date' }, { key: 'journal', label: 'Journal' },
    { key: 'piece', label: 'Pièce' }, { key: 'account', label: 'Compte' }, { key: 'tiers', label: 'Tiers' },
    { key: 'label', label: 'Libellé' },
    { key: 'debit', label: 'Débit', type: 'money' }, { key: 'credit', label: 'Crédit', type: 'money' },
    { key: 'lettre', label: 'Lettrage' }, { key: 'currency', label: 'Devise' }
  ]);

  // ---------- le livre-journal (8.9.0) ----------
  //
  // « Écriture comptable dans le journal », le second terme du comptable : chaque pièce porte un
  // numéro CONTINU dans l'exercice, et rien ne peut manquer entre deux numéros. Les écritures étant
  // déduites des pièces, le numéro l'est aussi : une pièce datée en arrière dans un mois OUVERT
  // décale les suivantes — c'est exactement pour ça qu'on clôture (6.0.0) : sur un mois clos, plus
  // rien ne bouge, donc plus aucun numéro. La règle est écrite à l'écran.
  function numerosDuJournal(data, company, year, opts) {
    const y = String(year).slice(0, 4);
    const tout = journalEntries(data, company, { from: `${y}-01-01`, to: `${y}-12-31` }, opts);
    const nums = {};
    let n = 0;
    tout.forEach(e => { const k = `${e.journal}|${e.piece}|${e.date}`; if (!nums[k]) nums[k] = ++n; });
    return { nums, dernier: n };
  }
  const cleDePiece = e => `${e.journal}|${e.piece}|${e.date}`;
  // Les écritures de la période, numérotées dans l'exercice de son premier jour.
  function livreJournal(data, company, period, opts) {
    const y = String((period && period.from) || today()).slice(0, 4);
    const { nums } = numerosDuJournal(data, company, y, opts);
    return journalEntries(data, company, period, opts).map(e => ({ ...e, numero: nums[cleDePiece(e)] || 0, exercice: y }));
  }

  // Le fichier des écritures (FEC, H3) de la période : le livre-journal, numéroté dans l'exercice,
  // passé au constructeur partagé (`Compta.fichierFec`). Ce que l'entreprise sait et que le
  // constructeur ne sait pas lui est prêté ici : le nom de chaque compte (le plan réglé), le compte
  // auxiliaire d'un tiers (411 + son code figé, 8.8.0), la devise (trois décimales pour le dinar).
  // `ValidDate` porte la date de la pièce : SkanFact ne VALIDE pas une écriture, il la déduit d'une
  // pièce émise — et le fichier le dit (`provisoire`) tant qu'un mois de la période n'est pas clôturé,
  // parce que les numéros d'un mois ouvert peuvent encore bouger (8.9.0).
  function fecEntreprise(data, company, period) {
    const acc = chartAccounts(data);
    const codesC = codesAuxiliaires((data && data.clients) || []);
    const codesF = codesAuxiliaires((data && data.suppliers) || []);
    const lignes = livreJournal(data, company, period, {});
    const r = Compta.fichierFec(lignes, {
      identifiant: (company && company.matricule) || '',
      fin: period && period.to,
      decimales: decimalsFor(company && company.currency),
      nomJournal: journalLabel,
      nomCompte: (account, l) => accountLabel(data, account, l.tiers),
      aux: l => {
        if (!l.tiersId || (l.role !== 'clients' && l.role !== 'fournisseurs')) return null;
        const code = (l.role === 'clients' ? codesC : codesF)[l.tiersId];
        if (!code) return null;
        const col = l.role === 'clients' ? acc.clients : acc.fournisseurs;
        return { num: String(l.account || '').length > col.length ? String(l.account) : col + code, lib: l.tiers || '' };
      }
    });
    const clos = closedUntil(data);
    r.provisoire = !!(r.au && (!clos || r.au > clos));
    return r;
  }

  // Le journal centralisateur : mois par mois, journal par journal, le total débit et crédit.
  // C'est le récapitulatif que le livre-journal coté et paraphé reprend.
  function journalCentralisateur(data, company, year, opts) {
    const y = String(year).slice(0, 4);
    const tout = journalEntries(data, company, { from: `${y}-01-01`, to: `${y}-12-31` }, opts);
    const codes = ENTRY_JOURNALS.map(j => j[0]).filter(c => tout.some(e => e.journal === c));
    tout.forEach(e => { if (e.journal && !codes.includes(e.journal)) codes.push(e.journal); });
    const mois = [];
    for (let m = 1; m <= 12; m++) {
      const mm = `${y}-${pad2(m)}`;
      const du = tout.filter(e => (e.date || '').slice(0, 7) === mm);
      const par = {};
      const pieces = new Set();
      codes.forEach(c => { par[c] = { debit: 0, credit: 0, pieces: 0 }; });
      const vues = {};
      du.forEach(e => {
        const p = par[e.journal]; p.debit = round3(p.debit + e.debit); p.credit = round3(p.credit + e.credit);
        const k = cleDePiece(e); if (!vues[k]) { vues[k] = true; p.pieces++; pieces.add(k); }
      });
      mois.push({ month: mm, label: MONTHS_FR[m - 1], par, debit: round3(du.reduce((s, e) => s + e.debit, 0)), credit: round3(du.reduce((s, e) => s + e.credit, 0)), pieces: pieces.size });
    }
    const totaux = {};
    codes.forEach(c => { totaux[c] = { debit: round3(mois.reduce((s, m) => s + m.par[c].debit, 0)), credit: round3(mois.reduce((s, m) => s + m.par[c].credit, 0)), pieces: mois.reduce((s, m) => s + m.par[c].pieces, 0) }; });
    return {
      year: y, journaux: codes.map(c => ({ code: c, label: journalLabel(c) })), mois, totaux,
      debit: round3(mois.reduce((s, m) => s + m.debit, 0)), credit: round3(mois.reduce((s, m) => s + m.credit, 0)),
      pieces: mois.reduce((s, m) => s + m.pieces, 0)
    };
  }

  // ---- les opérations diverses saisies à la main ----
  // Une OD est la seule écriture que l'utilisateur ÉCRIT. Elle n'entre qu'équilibrée : c'est la
  // règle de la partie double, et un logiciel qui accepterait un déséquilibre livrerait une
  // comptabilité fausse au comptable.
  // Le refus dit ses montants comme l'écran (10.14.1, M-05) : « Débit 1250.500 » se lit mille
  // deux cent cinquante mille. La devise est celle de la société (`company`), le dinar sans elle.
  function odValide(od, company) {
    const erreurs = [];
    const lignes = (od && Array.isArray(od.lignes) ? od.lignes : []).filter(l => l && (String(l.compte || '').trim() || Number(l.debit) || Number(l.credit)));
    if (!od || !/^\d{4}-\d{2}-\d{2}$/.test(String(od.date || ''))) erreurs.push('La date manque.');
    if (!String((od && od.label) || '').trim()) erreurs.push('Le libellé manque : c\'est lui qui dira au comptable de quoi il s\'agit.');
    if (lignes.length < 2) erreurs.push('Une écriture a au moins deux lignes : un compte au débit, un compte au crédit.');
    lignes.forEach((l, i) => {
      const compte = String(l.compte || '').trim();
      if (!/^\d{1,12}$/.test(compte)) erreurs.push(`Ligne ${i + 1} : le compte doit être un numéro.`);
      const d = Number(l.debit) || 0, c = Number(l.credit) || 0;
      if (d < 0 || c < 0) erreurs.push(`Ligne ${i + 1} : un montant négatif change de colonne, il ne garde pas son signe.`);
      if (d && c) erreurs.push(`Ligne ${i + 1} : une ligne va au débit OU au crédit, pas les deux.`);
      if (!d && !c) erreurs.push(`Ligne ${i + 1} : aucun montant.`);
    });
    const debit = round3(lignes.reduce((s, l) => s + (Number(l.debit) || 0), 0));
    const credit = round3(lignes.reduce((s, l) => s + (Number(l.credit) || 0), 0));
    if (lignes.length >= 2 && round3(debit - credit) !== 0) erreurs.push(`Débit ${money(debit, (company && company.currency) || 'DT')} ≠ crédit ${money(credit, (company && company.currency) || 'DT')} : l'écriture ne tombe pas juste.`);
    return { ok: !erreurs.length, erreurs, debit, credit, lignes };
  }
  // Le numéro de pièce d'une OD : OD-AAAA-NNN, continu dans l'année, jamais réutilisé.
  function odPiece(data, dateIso) {
    const y = String(dateIso || today()).slice(0, 4);
    const key = `od-${y}`;
    const existants = (data.ecrituresOD || []).map(o => String(o.piece || '')).filter(p => p.startsWith(`OD-${y}-`)).map(p => parseInt(p.split('-')[2], 10) || 0);
    const seq = Math.max(existants.length ? Math.max(...existants) : 0, Number((data.counters || {})[key]) || 0) + 1;
    if (!data.counters) data.counters = {};
    data.counters[key] = seq;
    return `OD-${y}-${String(seq).padStart(3, '0')}`;
  }
  // Les comptes qu'on propose à la saisie d'une OD : ceux déjà mouvementés, puis le plan.
  // 10.14.1 (PERF-01) — dans un LOT, et sans les à-nouveaux. La liste demandait toutes les écritures
  // de toute l'histoire HORS lot : chaque facture relisait tous les avoirs pour son lettrage, et les
  // à-nouveaux recalculaient, pour chaque exercice, tout ce qui le précède. Mesuré sur dix factures
  // par mois : six secondes pour sept ans, quinze et demie pour dix — au-delà des douze secondes du
  // chien de garde, qui rechargeait la page sur « + Opération diverse ». Un à-nouveau ne rouvre que
  // des comptes que les écritures réelles ont déjà mouvementés, sauf le RÉSULTAT, où il porte le net
  // des exercices passés : il se compte à part, par la règle de la section des à-nouveaux.
  function comptesProposes(data, company) { return enLot(() => comptesProposesCalcul(data, company)); }
  function comptesProposesCalcul(data, company) {
    const vus = {};
    const reelles = journalEntries(data, company, { from: '', to: '' }, { sections: SECTIONS_ECRITURES.filter(s => s !== 'anouveaux') });
    reelles.forEach(e => { if (e.account && !vus[e.account]) vus[e.account] = accountLabel(data, e.account, e.role ? e.tiers : ''); });
    const resultat = chartAccounts(data).resultat;
    if (resultat && !vus[resultat] && resultatRouvert(reelles)) vus[resultat] = accountLabel(data, resultat, '');
    const out = Object.keys(vus).sort().map(n => ({ compte: n, label: vus[n], utilise: true }));
    PLAN_COMPTABLE.forEach(([n, l]) => { if (n.length >= 2 && !vus[n]) out.push({ compte: n, label: l, utilise: false }); });
    return out;
  }
  // Le compte de résultat est-il rouvert par un à-nouveau ? La section des à-nouveaux en pose un au
  // 1er janvier de chaque exercice jusqu'à l'année en cours, et y porte le net de gestion de TOUT ce
  // qui précède quand il n'est pas nul. Les écritures arrivent triées par date : il suffit de lire ce
  // net à chaque fin d'exercice passé.
  function resultatRouvert(reelles) {
    const cette = Number(today().slice(0, 4));
    let net = 0, an = null;
    for (const e of reelles) {
      const y = Number(String(e.date || '').slice(0, 4));
      if (!(y > 1900)) continue;
      if (an !== null && y !== an && an < cette && net) return true;
      an = y;
      if (compteDeGestion(e.account)) net = round3(net + round3(e.debit - e.credit));
    }
    return an !== null && an < cette && !!net;
  }

  // ---- le lettrage ----
  // Rapprocher chaque règlement de sa facture, tiers par tiers. Les paiements sont déjà rattachés
  // aux pièces : le lettrage n'est pas une saisie, c'est une LECTURE — ce qui est soldé porte sa
  // lettre, ce qui reste ouvert est listé avec son reste.
  function lettrage(data, company, role, todayIso) {
    const t = todayIso || today();
    const clients = role !== 'fournisseurs';
    const liste = clients ? (data.clients || []) : (data.suppliers || []);
    const nom = id => (liste.find(x => x.id === id) || {}).name || '';
    const acc = chartAccounts(data);
    const codes = auxiliairesActifs(data) ? codesAuxiliaires(liste) : {};
    const base = clients ? acc.clients : acc.fournisseurs;
    const by = {};
    const tiersDe = id => (by[id] = by[id] || { tiersId: id, tiers: nom(id) || '(sans tiers)', account: id && codes[id] ? base + codes[id] : base, lettrees: 0, ouverts: [], reste: 0 });
    if (clients) {
      (data.documents || []).filter(d => d.type === 'facture' && d.status !== 'brouillon' && d.status !== 'annulée' && d.number).forEach(d => {
        const b = invoiceBalance(d, data, company);
        const r = tiersDe(d.clientId || '');
        // Un trop-perçu est ouvert, au crédit du client (10.14.0) : c'est le jumeau de l'avoir
        // fournisseur de la 10.2.0. Ne regarder que les restes positifs faisait dire au lettrage un
        // chiffre différent du 411, sur la même donnée.
        // Une ligne s'ADDITIONNE (10.14.0) : Montant − Avoirs − Réglé = Reste. Un trop-perçu s'affichait
        // « 3 685 − 3 685 = −1 005 » — l'avoir, invisible, faisait la différence. Chaque montant
        // est celui que le 411 porte : la facture et ses règlements à son taux, un avoir au taux de
        // la facture (l'écart de change est écrit à part), ou à son propre taux s'il est dans une
        // autre devise.
        // En BRUT (10.14.0), comme le 401 : le 411 porte ce que la pièce vaut, retenue comprise,
        // jusqu'à l'encaissement ; chaque encaissement le solde de ce que le client verse plus la
        // retenue qu'il garde pour l'État, et un avoir posé après règle aussi sa régularisation.
        const rs = retenueSubie(d, data, company);
        const brut = round3(b.totals.netToPay + b.totals.withholding);
        const montant = round3(toBase(d, brut, company));
        // Chaque morceau arrondi comme l'écriture l'arrondit : un millime d'écart sur une facture en
        // devise, et le lettrage ne retombe plus sur le 411.
        const avoirs = round3(b.credits.reduce((x, a) => { const ta = computeTotals(a, company);
          return x + toBase(d, montantDansDeviseDe(a, round3(ta.netToPay + ta.withholding), d, company), company) + toBase(d, rs.ajustements[a.id] || 0, company); }, 0));
        const regle = round3((d.payments || []).reduce((x, p, i) => x + toBase(d, Number(p.amount) || 0, company) + toBase(d, rs.parts[cleReglement(p, i)] || 0, company), 0));
        const reste = round3(montant - avoirs - regle);
        if (Math.abs(reste) <= 0.0005) { r.lettrees++; return; }
        r.ouverts.push({ id: d.id, piece: d.number, date: d.date, echeance: d.dueDate || '', montant, avoirs, regle, reste, retard: reste > 0 && !!(d.dueDate && d.dueDate < t) });
        r.reste = round3(r.reste + reste);
      });
      // Un avoir LIBRE — rattaché à aucune facture — est une somme due au client : le 411 la porte au
      // crédit, le relevé aussi. Un avoir rattaché est déjà dans le reste de sa facture.
      // En brut, comme le 411 : la retenue qu'il porte ne naîtra qu'au règlement qui l'emploiera.
      (data.documents || []).filter(d => d.type === 'avoir' && !d.creditOf && d.status !== 'brouillon' && d.status !== 'annulée' && d.number).forEach(d => {
        const net = round3(toBase(d, computeTotals(d, company).totalTTC, company));
        if (net <= 0.0005) return;
        const r = tiersDe(d.clientId || '');
        r.ouverts.push({ id: d.id, piece: d.number, date: d.date, echeance: '', montant: -net, avoirs: 0, regle: 0, reste: -net, retard: false });
        r.reste = round3(r.reste - net);
      });
    } else {
      (data.purchases || []).forEach(p => {
        const b = purchaseBalance(p, company, data);
        const r = tiersDe(p.supplierId || '');
        // Un avoir non imputé laisse le fournisseur DÉBITEUR : son reste est négatif, et il est
        // tout aussi ouvert qu'une facture impayée (10.2.0). Ne regarder que les restes positifs
        // faisait dire au lettrage un chiffre différent du solde du 401, sur la même donnée.
        if (Math.abs(b.remaining) <= 0.0005) { if ((p.payments || []).length) r.lettrees++; return; }
        // En dinars, comme la branche des clients : le lettrage se confronte au solde du 401, qui est
        // en monnaie de la société depuis la 10.1.0. Une facture de 1 190 € restait 1 190 ici.
        // Montant − Avoirs et acomptes − Réglé = Reste, comme côté clients (10.14.0). Un avoir non
        // imputé porte un montant NÉGATIF — c'est un crédit — et ce que le fournisseur en a
        // remboursé est un « réglé » négatif : l'argent est rentré.
        // En BRUT (10.14.0) : la retenue à la source naît au règlement, donc le 401 porte ce que la
        // pièce doit — retenue comprise — jusqu'au paiement, et chaque règlement le solde de ce
        // qu'il verse plus la retenue qu'il garde pour l'État.
        const sens = p.kind === 'avoir' ? -1 : 1;
        const rs = retenueDesReglements(p, company, data);
        const brut = round3(b.totals.netToPay + b.totals.withholding);
        const montant = round3(sens * toBase(p, brut, company));
        // Chaque pièce rattachée et sa régularisation de retenue, chaque règlement et sa part : arrondis
        // un par un, comme l'écriture les arrondit.
        const avoirs = (p.kind === 'avoir' || p.kind === 'acompte') ? 0 : round3(piecesLieesAchat(data, p.id).reduce((x, a) =>
          x + toBase(p, montantDansDeviseDe(a, imputationAchat(a, company).brut, p, company), company) + toBase(p, rs.ajustements[a.id] || 0, company), 0));
        const regle = round3(sens * (p.payments || []).reduce((x, y, i) => x + toBase(p, Number(y.amount) || 0, company) + toBase(p, rs.parts[cleReglement(y, i)] || 0, company), 0));
        const reste = round3(montant - avoirs - regle);
        r.ouverts.push({ id: p.id, piece: referenceAchat(p, data), date: p.date, echeance: p.dueDate || '', montant, avoirs, regle, reste, retard: reste > 0 && !!(p.dueDate && p.dueDate < t) });
        r.reste = round3(r.reste + reste);
      });
    }
    const rows = Object.keys(by).map(k => by[k]).filter(r => r.lettrees || r.ouverts.length)
      .map(r => ({ ...r, ouverts: r.ouverts.sort((a, b) => (a.date || '').localeCompare(b.date || '')) }))
      .sort((a, b) => b.reste - a.reste || a.tiers.localeCompare(b.tiers));
    return { role: clients ? 'clients' : 'fournisseurs', rows, reste: round3(rows.reduce((s, r) => s + r.reste, 0)), ouverts: rows.reduce((s, r) => s + r.ouverts.length, 0), lettrees: rows.reduce((s, r) => s + r.lettrees, 0) };
  }
  // ---------- l'exercice (9.0.0) ----------

  // L'état de rapprochement bancaire, tel qu'on le présente : on part du solde du RELEVÉ, on ajoute
  // ce que SkanFact a encaissé et que la banque n'a pas encore crédité, on retire ce que SkanFact a
  // payé et que la banque n'a pas encore débité — et l'on doit retomber sur le solde comptable.
  // L'écart, s'il en reste un, est une pièce qui manque d'un côté.
  function etatRapprochement(data, company, accountId, toIso) {
    const r = reconciliation(data, company, accountId, toIso);
    if (!r) return null;
    const pending = r.moves.filter(m => !m.reconciled);
    const entrees = pending.filter(m => m.amount > 0);
    const sorties = pending.filter(m => m.amount < 0);
    const totalEntrees = round3(entrees.reduce((s, m) => s + m.amount, 0));
    const totalSorties = round3(-sorties.reduce((s, m) => s + m.amount, 0));
    const theorique = r.statement == null ? null : round3(r.statement + totalEntrees - totalSorties);
    return {
      ...r, entrees, sorties, totalEntrees, totalSorties, theorique,
      ecart: theorique == null ? null : round3(r.balance - theorique),
      date: toIso || today()
    };
  }

  // Les états financiers simplifiés : bilan et état de résultat, déduits de la balance de
  // l'exercice. Une présentation d'ensemble (actifs non courants nets, stocks, créances,
  // trésorerie ; capitaux, dettes), PAS la liasse NCT 01 — c'est le cabinet qui l'établit. Ce qui est
  // garanti : actif = passif, et le résultat du bilan est celui de l'état de résultat.
  function etatsFinanciers(data, company, year, toIso, opts) {
    const y = String(year).slice(0, 4);
    const to = toIso && toIso.slice(0, 4) === y ? toIso : `${y}-12-31`;
    const b = balanceGenerale(data, company, { from: `${y}-01-01`, to }, opts);
    const rows = b.rows.filter(r => r.solde);
    const acc = chartAccounts(data);
    const ligne = r => ({ account: r.account, label: r.label, montant: r.solde });
    // Le rangement vit dans compta.js, partagé avec le Cabinet (10.14.0) : deux copies avaient la
    // même faute (un emprunt compté dans les capitaux propres), et une copie corrigée seule aurait
    // fait dire deux bilans au client et à son comptable.
    const { actif, passif, produits, charges } = Compta.groupesDesEtats(rows,
      (r, montant) => ({ account: r.account, label: r.label, montant }), r => r.account === acc.amortissements);
    const resultat = round3(produits.total - charges.total);
    const totalActif = round3(actif.reduce((s, g) => s + g.total, 0));
    const totalPassif = round3(passif.reduce((s, g) => s + g.total, 0) + resultat);
    return {
      year: y, to, actif, passif, produits, charges, resultat, totalActif, totalPassif,
      equilibre: round3(totalActif - totalPassif) === 0,
      // Ce que la dotation de l'exercice en cours attend : elle ne s'écrit qu'au 31 décembre — sauf
      // celle d'un bien cédé, déjà passée au jour de la sortie, qu'on ne compte donc pas deux fois.
      dotationEnAttente: to < `${y}-12-31` ? round3(Math.max(0, depreciationFor(data, { from: `${y}-01-01`, to }) - charges.lignes.filter(l => l.account === acc.dotations).reduce((s, l) => s + l.montant, 0))) : 0,
      // Le stock suit le même calendrier (10.14.0) : le 37 porte le dernier inventaire, la page
      // Stock ce qui est sur l'étagère AUJOURD'HUI. En cours d'année, l'écart est la variation que
      // l'inventaire du 31 décembre écrira — et que le résultat simplifié compte déjà.
      variationStockEnAttente: to < `${y}-12-31` ? round3(stockTotals(data, to).value - (actif[2] ? actif[2].total : 0)) : 0,
      lignes: rows.map(ligne)
    };
  }
  const etatsCsvRows = e => [].concat(
    ...e.actif.map(g => g.lignes.map(l => ({ etat: 'Bilan — actif', groupe: g.titre, account: l.account, label: l.label, montant: l.montant }))),
    ...e.passif.map(g => g.lignes.map(l => ({ etat: 'Bilan — passif', groupe: g.titre, account: l.account, label: l.label, montant: l.montant }))),
    [{ etat: 'Bilan — passif', groupe: 'Résultat de l\'exercice', account: '', label: 'Résultat de l\'exercice', montant: e.resultat }],
    e.produits.lignes.map(l => ({ etat: 'État de résultat', groupe: 'Produits', account: l.account, label: l.label, montant: l.montant })),
    e.charges.lignes.map(l => ({ etat: 'État de résultat', groupe: 'Charges', account: l.account, label: l.label, montant: l.montant }))
  );
  const etatsCsvColumns = () => ([{ key: 'etat', label: 'État' }, { key: 'groupe', label: 'Rubrique' }, { key: 'account', label: 'Compte' }, { key: 'label', label: 'Intitulé' }, { key: 'montant', label: 'Montant', type: 'money' }]);

  const centralisateurCsvColumns = journaux => ([{ key: 'label', label: 'Mois' }]
    .concat(journaux.flatMap(j => [{ key: `${j.code}_d`, label: `${j.code} débit`, type: 'money' }, { key: `${j.code}_c`, label: `${j.code} crédit`, type: 'money' }]))
    .concat([{ key: 'debit', label: 'Total débit', type: 'money' }, { key: 'credit', label: 'Total crédit', type: 'money' }, { key: 'pieces', label: 'Pièces' }]));
  const centralisateurRows = c => c.mois.map(m => { const o = { label: m.label, debit: m.debit, credit: m.credit, pieces: m.pieces }; c.journaux.forEach(j => { o[`${j.code}_d`] = m.par[j.code].debit; o[`${j.code}_c`] = m.par[j.code].credit; }); return o; });

  // ---------- le grand livre et la balance (8.8.0) ----------
  //
  // Les deux documents qu'un cabinet tire en premier pour contrôler un dossier — et les deux termes
  // que le comptable de Skander a nommés : « mouvement de compte » (le grand livre : chaque compte,
  // ses lignes une à une, le solde qui avance) et la balance (tous les comptes, ouverture,
  // mouvements, soldes, et des totaux qui doivent tomber juste).
  //
  // Le SOLDE D'OUVERTURE d'une période est ce que le compte portait la veille du premier jour :
  // - les classes 1 à 5 (bilan) traversent les exercices : tout ce qui précède compte ;
  // - les classes 6 et 7 (gestion) repartent de zéro au 1er janvier : ce qui précède l'exercice ne
  //   compte pas dans le compte lui-même, mais son solde net (produits − charges des exercices
  //   passés) est porté au compte de résultat — sinon la balance d'ouverture ne tomberait pas juste.
  // C'est exactement ce que fait une écriture d'à-nouveau ; elle est ici DÉDUITE, pas saisie.
  function debutExercice(iso) { return `${String(iso || today()).slice(0, 4)}-01-01`; }

  // Les soldes de tous les comptes la veille de `period.from` : { compte → solde signé (D > 0) }.
  // Depuis la 9.0.0 la pièce d'à-nouveau du 1er janvier porte elle-même le passé (comptes de bilan
  // rouverts, résultat des exercices antérieurs) : l'ouverture d'une période se lit donc depuis le
  // début de son exercice, à-nouveau compris — jamais plus loin, sinon le passé compterait deux fois.
  function soldesOuverture(data, company, period, opts) {
    const from = period && period.from;
    if (!from) return {};
    const exo = debutExercice(from);
    if (from <= exo) return {};
    const avant = journalEntries(data, company, { from: exo, to: addDays(from, -1) }, opts);
    const out = {};
    avant.forEach(e => { out[e.account] = round3((out[e.account] || 0) + e.debit - e.credit); });
    Object.keys(out).forEach(k => { if (!out[k]) delete out[k]; });
    return out;
  }

  // La balance générale : une ligne par compte — solde d'ouverture, mouvements de la période,
  // solde de clôture — chacun rangé dans SA colonne (débiteur ou créditeur, jamais un signe).
  // `equilibree` est vrai quand les trois paires de totaux tombent juste : c'est le contrôle que le
  // comptable fait en premier, et la seule affirmation que cette page garantit.
  function balanceGenerale(data, company, period, opts) {
    const entries = journalEntries(data, company, period, opts);
    const ouv = soldesOuverture(data, company, period, opts);
    const by = {};
    const row = k => (by[k] = by[k] || { account: k, ouverture: 0, debit: 0, credit: 0, lignes: 0, tiers: '' });
    Object.keys(ouv).forEach(k => { row(k).ouverture = ouv[k]; });
    entries.forEach(e => {
      const r = row(e.account);
      r.debit = round3(r.debit + e.debit); r.credit = round3(r.credit + e.credit); r.lignes++;
      if (e.role && e.tiers && !r.tiers) r.tiers = e.tiers;
    });
    const rows = Object.keys(by).sort().map(k => {
      const r = by[k];
      const solde = round3(r.ouverture + r.debit - r.credit);
      return {
        ...r, label: accountLabel(data, k, r.tiers), classe: classeDe(k),
        ouvertureD: r.ouverture > 0 ? r.ouverture : 0, ouvertureC: r.ouverture < 0 ? round3(-r.ouverture) : 0,
        solde, soldeD: solde > 0 ? solde : 0, soldeC: solde < 0 ? round3(-solde) : 0
      };
    });
    const sum = f => round3(rows.reduce((s, r) => s + f(r), 0));
    const totals = {
      ouvertureD: sum(r => r.ouvertureD), ouvertureC: sum(r => r.ouvertureC),
      debit: sum(r => r.debit), credit: sum(r => r.credit),
      soldeD: sum(r => r.soldeD), soldeC: sum(r => r.soldeC)
    };
    const equilibree = round3(totals.ouvertureD - totals.ouvertureC) === 0
      && round3(totals.debit - totals.credit) === 0 && round3(totals.soldeD - totals.soldeC) === 0;
    return { rows, totals, equilibree, period };
  }

  // Le grand livre : pour chaque compte, ses mouvements un par un et le solde qui avance.
  // `opts.compte` limite à un compte (ou à un préfixe : « 4 » donne tous les tiers).
  function grandLivre(data, company, period, opts) {
    opts = opts || {};
    const filtre = String(opts.compte || '');
    const entries = journalEntries(data, company, period, opts);
    const ouv = soldesOuverture(data, company, period, opts);
    const comptes = {};
    const get = k => (comptes[k] = comptes[k] || { account: k, ouverture: ouv[k] || 0, lignes: [], debit: 0, credit: 0, tiers: '' });
    Object.keys(ouv).forEach(k => { if (!filtre || k.startsWith(filtre)) get(k); });
    entries.forEach(e => {
      if (filtre && !e.account.startsWith(filtre)) return;
      const c = get(e.account);
      c.lignes.push(e);
      if (e.role && e.tiers && !c.tiers) c.tiers = e.tiers;
    });
    const out = Object.keys(comptes).sort().map(k => {
      const c = comptes[k];
      let solde = c.ouverture;
      c.lignes.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.journal || '').localeCompare(b.journal || '') || TRI_NUMERIQUE.compare((a.piece || ''), b.piece || ''));
      c.lignes = c.lignes.map(e => { solde = round3(solde + e.debit - e.credit); c.debit = round3(c.debit + e.debit); c.credit = round3(c.credit + e.credit); return { ...e, solde }; });
      return { ...c, label: accountLabel(data, k, c.tiers), classe: classeDe(k), solde };
    });
    return {
      comptes: out,
      debit: round3(out.reduce((s, c) => s + c.debit, 0)),
      credit: round3(out.reduce((s, c) => s + c.credit, 0)),
      lignes: out.reduce((s, c) => s + c.lignes.length, 0),
      period
    };
  }

  // La balance auxiliaire : un client ou un fournisseur par ligne, avec ce qu'il devait à
  // l'ouverture, ce qui a été facturé et réglé, et ce qui reste. Elle se lit sans comptes
  // auxiliaires (les lignes portent leur tiers), mais c'est avec eux que le cabinet la reconnaît.
  function balanceAuxiliaire(data, company, period, role, opts) {
    const liste = role === 'fournisseurs' ? (data.suppliers || []) : (data.clients || []);
    const nom = id => (liste.find(t => t.id === id) || {}).name || '';
    const acc = chartAccounts(data);
    const base = role === 'fournisseurs' ? acc.fournisseurs : acc.clients;
    const codes = auxiliairesActifs(data) ? codesAuxiliaires(liste) : {};
    const cle = e => e.tiersId || ('~' + (e.tiers || ''));
    const by = {};
    const row = e => {
      const k = cle(e);
      return by[k] = by[k] || { tiersId: e.tiersId || '', tiers: e.tiers || nom(e.tiersId) || '(sans tiers)', account: e.tiersId && codes[e.tiersId] ? base + codes[e.tiersId] : base, ouverture: 0, debit: 0, credit: 0, lignes: 0 };
    };
    // L'ouverture se lit depuis le début de l'EXERCICE, à-nouveau compris — jamais depuis le début
    // du temps. Depuis la 10.14.0 la pièce AN rouvre chaque tiers avec son rôle : lue avec les
    // écritures réelles des années passées, elle compterait chaque client une fois par exercice
    // traversé (la règle de `soldesOuverture`, 9.0.0, que cette fonction n'appliquait pas).
    const exo = debutExercice(period.from);
    if (period.from && period.from > exo) {
      journalEntries(data, company, { from: exo, to: addDays(period.from, -1) }, opts).forEach(e => {
        if (e.role !== role) return;
        const r = row(e); r.ouverture = round3(r.ouverture + e.debit - e.credit);
      });
    }
    journalEntries(data, company, period, opts).forEach(e => {
      if (e.role !== role) return;
      const r = row(e); r.debit = round3(r.debit + e.debit); r.credit = round3(r.credit + e.credit); r.lignes++;
    });
    const rows = Object.keys(by).map(k => by[k]).map(r => {
      const solde = round3(r.ouverture + r.debit - r.credit);
      return { ...r, solde, ouvertureD: r.ouverture > 0 ? r.ouverture : 0, ouvertureC: r.ouverture < 0 ? round3(-r.ouverture) : 0, soldeD: solde > 0 ? solde : 0, soldeC: solde < 0 ? round3(-solde) : 0 };
    }).filter(r => r.ouverture || r.debit || r.credit).sort((a, b) => a.account.localeCompare(b.account) || a.tiers.localeCompare(b.tiers));
    const sum = f => round3(rows.reduce((s, r) => s + f(r), 0));
    return {
      role, rows,
      totals: { ouvertureD: sum(r => r.ouvertureD), ouvertureC: sum(r => r.ouvertureC), debit: sum(r => r.debit), credit: sum(r => r.credit), soldeD: sum(r => r.soldeD), soldeC: sum(r => r.soldeC) }
    };
  }

  const balanceCsvColumns = () => ([
    { key: 'account', label: 'Compte' }, { key: 'label', label: 'Intitulé' },
    { key: 'ouvertureD', label: 'Ouverture débit', type: 'money' }, { key: 'ouvertureC', label: 'Ouverture crédit', type: 'money' },
    { key: 'debit', label: 'Mouvements débit', type: 'money' }, { key: 'credit', label: 'Mouvements crédit', type: 'money' },
    { key: 'soldeD', label: 'Solde débiteur', type: 'money' }, { key: 'soldeC', label: 'Solde créditeur', type: 'money' }
  ]);
  const balanceAuxCsvColumns = () => ([
    { key: 'account', label: 'Compte' }, { key: 'tiers', label: 'Tiers' },
    { key: 'ouvertureD', label: 'Ouverture débit', type: 'money' }, { key: 'ouvertureC', label: 'Ouverture crédit', type: 'money' },
    { key: 'debit', label: 'Mouvements débit', type: 'money' }, { key: 'credit', label: 'Mouvements crédit', type: 'money' },
    { key: 'soldeD', label: 'Solde débiteur', type: 'money' }, { key: 'soldeC', label: 'Solde créditeur', type: 'money' }
  ]);
  // Le grand livre à plat : une ligne par mouvement, précédée du compte et suivie du solde progressif.
  function grandLivreRows(gl) {
    const out = [];
    gl.comptes.forEach(c => {
      out.push({ account: c.account, label: c.label, date: '', journal: '', piece: '', libelle: 'Solde d\'ouverture', debit: 0, credit: 0, solde: c.ouverture });
      c.lignes.forEach(e => out.push({ account: c.account, label: c.label, date: e.date, journal: e.journal, piece: e.piece, libelle: e.label, debit: e.debit, credit: e.credit, solde: e.solde }));
    });
    return out;
  }
  const grandLivreCsvColumns = () => ([
    { key: 'account', label: 'Compte' }, { key: 'label', label: 'Intitulé' }, { key: 'date', label: 'Date', type: 'date' },
    { key: 'journal', label: 'Journal' }, { key: 'piece', label: 'Pièce' }, { key: 'libelle', label: 'Libellé' },
    { key: 'debit', label: 'Débit', type: 'money' }, { key: 'credit', label: 'Crédit', type: 'money' }, { key: 'solde', label: 'Solde', type: 'money' }
  ]);

  // ---------- conversions entre documents (2.6.0) ----------
  // Ce qu'une pièce peut devenir. Le résultat est toujours un brouillon : rien n'est émis sans relecture.
  // Le chemin complet d'une vente de marchandise : devis → bon de commande → bon de livraison → facture.
  const CONVERSIONS = {
    devis: ['proforma', 'commande', 'livraison', 'contrat'],
    proforma: ['facture', 'livraison'],
    commande: ['livraison', 'proforma', 'facture'],
    livraison: ['facture'],
    facture: ['livraison'],
    contrat: [],
    avoir: []
  };
  const CONVERSION_LABELS = {
    proforma: 'Établir une proforma', commande: 'Enregistrer le bon de commande', livraison: 'Établir le bon de livraison',
    contrat: 'Rédiger le contrat à signer', facture: 'Facturer'
  };
  // Champs qui n'ont de sens que sur la pièce d'origine et ne doivent jamais suivre la conversion.
  const NOT_COPIED = ['payments', 'emails', 'reminders', 'remindAfter', 'withholdingCertificate', 'deposit',
    'settles', 'recurringId', 'creditOf', 'creditOfNumber', 'creditReason', 'attachments', 'clauses',
    // L'instant d'émission appartient à la pièce émise : une pièce tirée d'elle naît brouillon.
    'issuedTs', 'regimeTva',
    // Un ticket de caisse (10.15.0) : une pièce tirée de lui est une pièce ordinaire, pas un second ticket.
    'ticket', 'caisse',
    // La mention d'exonération de retenue se fige à l'émission (10.15.0, H7) : une pièce tirée d'une
    // facture émise se juge à SA date, pas avec l'attestation de l'autre.
    'exonerationRS',
    // (1.306.0) La réponse du client à un devis (quand, comment, pourquoi) et sa marque « modifié après l'envoi » sont les
    // siennes : une commande tirée d'un devis accepté ne porte pas son acceptation.
    'reponse', 'modifieApresEnvoi',
    // Les bons de livraison qu'une facture regroupe (brique 86) sont les siens : une pièce tirée d'elle
    // n'en couvre aucun.
    'bonsLivraison'];

  // La retenue à la source proposée pour un client : la sienne s'il en a une (même 0 %), sinon celle
  // de la société. UNE règle pour l'éditeur (`clientWithholding`) et pour les conversions.
  function retenueDuClient(client, company) {
    if (client && client.withholdingRate != null && client.withholdingRate !== '') return Number(client.withholdingRate) || 0;
    return Number((company || {}).defaultWithholdingRate) || 0;
  }

  // `client` (10.14.1, MR-01) : une facture tirée d'une proforma, d'un bon de commande ou de
  // livraison naissait avec un timbre chez un client EXONÉRÉ, et sans la retenue du client quand
  // la pièce de départ n'en porte pas (un bon, un devis). « Facturer ce devis » les posait depuis
  // la 9.1.1 (`invoiceFromQuote`) ; « Transformer ▾ » non — deux chemins vers la même facture, deux
  // montants nets. La retenue d'une pièce qui en PORTE une (proforma) reste la sienne : c'est un
  // choix fait sur cette pièce, la conversion ne le défait pas.
  function convertDoc(doc, targetType, company, todayIso, client) {
    const date = todayIso || today();
    const PORTE_RETENUE = ['facture', 'avoir', 'proforma'];
    const copy = JSON.parse(JSON.stringify(doc));
    NOT_COPIED.forEach(k => { delete copy[k]; });
    delete copy.fromQuoteId; delete copy.fromQuoteNumber;
    const days = delaiJours(targetType === 'devis' ? company.quoteValidityDays : company.paymentTermsDays, 30);
    const out = {
      ...copy, id: uid(), type: targetType, number: '', status: 'brouillon', date,
      dueDate: ['facture', 'proforma', 'devis'].includes(targetType) ? addDays(date, Number(days) || 30) : '',
      createdAt: Date.now(), payments: [],
      applyStamp: targetType === 'facture' && !(client && client.stampExempt),
      withholdingRate: !PORTE_RETENUE.includes(targetType) ? 0
        : PORTE_RETENUE.includes(doc.type) ? (Number(doc.withholdingRate) || 0)
        : client ? retenueDuClient(client, company) : (Number(doc.withholdingRate) || 0),
      // d'où vient cette pièce : affiché sur le document, dans l'historique, et cliquable dans l'app
      fromDocId: doc.id, fromDocType: doc.type, fromDocNumber: doc.number || ''
    };
    // Le devis reste l'origine reconnue par la facturation (acompte, solde, tableau de bord) : on la garde.
    if (doc.type === 'devis' && targetType === 'facture') { out.fromQuoteId = doc.id; out.fromQuoteNumber = doc.number || ''; }
    else if (doc.fromQuoteId) { out.fromQuoteId = doc.fromQuoteId; out.fromQuoteNumber = doc.fromQuoteNumber || ''; }
    if (targetType === 'contrat') out.clauses = { ...DEFAULT_CLAUSES, ...(doc.clauses || {}) };
    if (targetType === 'livraison') out.hidePrices = true;   // un bon de livraison accompagne la marchandise : les prix n'ont rien à y faire
    if (doc.type === 'livraison' && targetType === 'facture') out.lines = (out.lines || []).map(l => (l && !l.noDiscount ? { ...l, fromBon: doc.number || '' } : l));
    else (out.lines || []).forEach(l => { if (l) delete l.fromBon; });
    return out;
  }

  // Les pièces issues d'une autre, dans l'ordre où elles ont été établies.
  // Tout ce qui pointe vers cette pièce. Supprimer un devis laissait des factures pointant vers un
  // identifiant qui n'existe plus : leur en-tête continuait d'annoncer « établie à partir du devis
  // DEV-2026-012 », et le lien de l'historique menait au tableau de bord. On ne refuse pas la
  // suppression — la pièce reste la propriété de son auteur — mais on NOMME ce qui va se rompre.
  function piecesLiees(data, doc) {
    if (!doc || !doc.id) return [];
    const out = [];
    (data.documents || []).forEach(d => {
      if (d.id === doc.id) return;
      let quoi = '';
      if (d.fromQuoteId === doc.id) quoi = d.deposit ? `acompte ${acompteDit(d.deposit, d.currency)}` : d.settles ? 'facture de solde' : 'facture du devis';
      else if (d.fromDocId === doc.id) quoi = 'issue de cette pièce';
      else if (d.type === 'facture' && Array.isArray(d.bonsLivraison) && d.bonsLivraison.some(b => b.id === doc.id)) quoi = 'facture de ce bon';
      else if (d.creditOf === doc.id) quoi = 'avoir sur cette facture';
      else if (d.settles && d.settles.quoteId === doc.id) quoi = 'facture de solde';
      if (quoi) out.push({ id: d.id, number: d.number || '(brouillon)', type: d.type, quoi });
    });
    return out.sort((a2, b2) => TRI_NUMERIQUE.compare((a2.number || ''), b2.number || ''));
  }

  function derivedDocs(doc, data) {
    if (!doc || !doc.id) return [];   // sans identifiant, `undefined === undefined` renverrait toute la base
    // Une facture de plusieurs bons de livraison (brique 86) est tirée de chacun d'eux.
    return (data.documents || []).filter(d => d.fromDocId === doc.id || (d.type === 'facture' && Array.isArray(d.bonsLivraison) && d.bonsLivraison.some(b => b.id === doc.id)))
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0));
  }
  // Toutes les pièces d'une même vente, sauf celle-ci (10.12.0). `derivedDocs` ne voit que les
  // ENFANTS directs : un bon de livraison tiré d'une proforma déjà facturée proposait « Facturer »,
  // et le chantier l'était deux fois. On remonte à l'origine (une pièce transformée porte
  // `fromDocId`, une facture tirée d'un devis `fromQuoteId`, un acompte `deposit.quoteId`), puis on
  // redescend. Bornée : une chaîne corrompue (une boucle) ne doit jamais geler l'écran (5.2.3).
  function chaineDePieces(data, doc) {
    if (!doc || !doc.id) return [];
    const docs = data.documents || [];
    const parent = x => x.fromDocId || x.fromQuoteId || (x.deposit && x.deposit.quoteId) || '';
    const enfantDe = (x, id) => x.fromDocId === id || x.fromQuoteId === id || !!(x.deposit && x.deposit.quoteId === id)
      || (x.type === 'facture' && Array.isArray(x.bonsLivraison) && x.bonsLivraison.some(b => b.id === id));
    let racine = doc;
    for (let i = 0; i < 50; i++) { const p = parent(racine) && docs.find(x => x.id === parent(racine)); if (!p || p.id === doc.id) break; racine = p; }
    const vus = new Set([racine.id]); const file = [racine];
    while (file.length && vus.size < 1000) {
      const x = file.shift();
      docs.forEach(d => { if (d.id && !vus.has(d.id) && enfantDe(d, x.id)) { vus.add(d.id); file.push(d); } });
    }
    vus.add(doc.id);
    return docs.filter(d => vus.has(d.id) && d.id !== doc.id);
  }

  // ---------- les commandes fournisseurs et leurs réceptions (plateforme, brique 87 ; 14 § 3.2) ----------
  // La commande qu'on passe à un fournisseur (`data.supplierOrders`) et ses réceptions (`data.receptions`),
  // le miroir d'une commande client et de ses bons de livraison. Ce ne sont pas des pièces comptables :
  // elles ne vivent pas parmi les achats (la facture du fournisseur, elle, en est une). Une réception tirée
  // d'une commande reprend ce qui reste à recevoir, chaque ligne rattachée à la sienne (`ligneCommande`),
  // et UNE fonction compte ce qui est reçu : le statut de la commande, son panneau et la réception suivante
  // la lisent. Seule une réception VALIDÉE a reçu ; en brouillon, elle est « en préparation » ; annulée,
  // elle ne compte pas.
  // « demande » : une demande de prix (brique 89), avant de commander ; elle ne reçoit rien.
  const STATUTS_COMMANDE_FOURNISSEUR = ['demande', 'brouillon', 'envoyée', 'soldée', 'annulée'];
  // Le numéro suivant d'une liste qui n'est pas une pièce de vente (BCF-2026-001, BR-2026-001) : le plus
  // grand déjà porté ou le compteur, le plus grand des deux, plus un.
  function numeroSuivant(data, liste, prefixe, dateIso) {
    const annee = (dateIso || today()).slice(0, 4);
    const cle = `${prefixe}-${annee}`;
    data.counters = data.counters || {};
    const vus = (liste || []).filter(x => x.number && String(x.number).startsWith(`${prefixe}-${annee}-`)).map(x => parseInt(String(x.number).split('-')[2], 10) || 0);
    const n = Math.max(vus.length ? Math.max(...vus) : 0, data.counters[cle] || 0) + 1;
    data.counters[cle] = n;
    return `${prefixe}-${annee}-${String(n).padStart(3, '0')}`;
  }
  function receptionsDeCommande(data, commande) {
    if (!commande || !commande.id) return [];
    return (data.receptions || []).filter(r => r.orderId === commande.id && !/^annul/.test(r.status || ''))
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0));
  }
  function suiviCommandeFournisseur(data, commande) {
    const lignes = ((commande && commande.lines) || []).map((l, i) => ({ i, label: l.label || '', unit: l.unit || '', commandee: round3(Number(l.qty) || 0), recue: 0, enPreparation: 0 }));
    const receptions = receptionsDeCommande(data, commande);
    receptions.forEach(r => (r.lines || []).forEach(l => {
      const x = Number.isInteger(l.ligneCommande) ? lignes[l.ligneCommande] : null;
      if (!x) return;
      const q = round3(Number(l.qty) || 0);
      if (r.status === 'validée') x.recue = round3(x.recue + q);
      else if (r.status === 'brouillon') x.enPreparation = round3(x.enPreparation + q);
    }));
    lignes.forEach(x => {
      x.reste = round3(Math.max(0, x.commandee - x.recue));
      x.enPlus = round3(Math.max(0, x.recue - x.commandee));
      x.aProposer = round3(Math.max(0, x.commandee - x.recue - x.enPreparation));
    });
    const utiles = lignes.filter(x => x.commandee > 0);
    const toutRecu = utiles.length > 0 && utiles.every(x => x.reste <= 0);
    return {
      lignes, receptions, brouillons: receptions.filter(r => r.status === 'brouillon'),
      recue: toutRecu, partielle: !toutRecu && lignes.some(x => x.recue > 0),
      aProposer: utiles.some(x => x.aProposer > 0)
    };
  }
  // (1.284.2, revue du Stock joué à la main) Ce qu'un article a déjà en commande chez les fournisseurs : le reste à
  // recevoir de chaque commande ouverte (brouillon, envoyée, reçue en partie), pas une demande de prix, pas une commande
  // soldée ou annulée. Sans lui, l'article commandé restait « à commander » et se commandait deux fois.
  function commandesEnCoursDeLArticle(data, itemId) {
    const out = [];
    (data.supplierOrders || []).forEach(o => {
      const st = o.status || 'brouillon';
      if (st === 'demande' || st === 'soldée' || /^annul/.test(st)) return;
      const suivi = suiviCommandeFournisseur(data, o);
      const reste = round3((o.lines || []).reduce((a, l, i) => a + (l.itemId === itemId ? (suivi.lignes[i] ? suivi.lignes[i].reste : 0) : 0), 0));
      if (reste > 0) out.push({ id: o.id, number: o.number || '', reste });
    });
    return out;
  }
  // Le statut d'une commande fournisseur : celui qu'on choisit, et, dès qu'elle a reçu quelque chose,
  // celui que disent ses réceptions (« reçue en partie », « reçue »). « Soldée » choisie à la main clôt une
  // commande dont le reste ne viendra pas ; « annulée » n'attend plus rien.
  function statutCommandeFournisseur(data, commande) {
    const st = (commande && commande.status) || 'brouillon';
    if (st === 'soldée' || /^annul/.test(st)) return st;
    const s = suiviCommandeFournisseur(data, commande);
    return s.recue ? 'reçue' : s.partielle ? 'partielle' : st;
  }
  // Le montant d'une commande pour l'accord d'un responsable (brique 114 ; 03 D11) : son total hors taxes, ramené
  // dans la devise de l'entreprise. Le serveur compare le même chiffre, avec ce code, au seuil de l'entreprise.
  function montantCommandeFournisseur(commande, company) {
    return toBase(commande, computeTotals(commande, company).netHT, company);
  }
  // La réception suivante d'une commande : ce qui reste à recevoir, et rien d'autre. Rien à recevoir : null.
  function receptionDeCommande(data, commande, todayIso) {
    const s = suiviCommandeFournisseur(data, commande);
    const lines = (commande.lines || []).map((l, i) => ({ ...JSON.parse(JSON.stringify(l)), qty: s.lignes[i] ? s.lignes[i].aProposer : 0, ligneCommande: i }))
      .filter(l => l.qty > 0);
    if (!lines.length) return null;
    return { id: uid(), number: '', status: 'brouillon', date: todayIso || today(), supplierId: commande.supplierId || '', orderId: commande.id,
      orderNumber: commande.number || '', currency: commande.currency || '', exchangeRate: commande.exchangeRate || '', lines, notes: '', createdAt: Date.now() };
  }
  // Les réceptions validées qu'aucune facture d'achat ne couvre encore (une facture supprimée les libère).
  function receptionsAFacturer(data, supplierId) {
    const couvertes = new Set();
    (data.purchases || []).forEach(p => (Array.isArray(p.receptions) ? p.receptions : []).forEach(x => couvertes.add(x.id)));
    return (data.receptions || []).filter(r => r.status === 'validée' && !couvertes.has(r.id) && (!supplierId || r.supplierId === supplierId));
  }
  // Les lignes de la facture du fournisseur, depuis ses réceptions validées : chaque ligne de commande en
  // UNE ligne, sa quantité reçue en tout au prix de la commande (un arrondi, pas un par réception) ; la
  // destination « stock » pour un article suivi, et la marque `recue` : la réception l'a déjà fait entrer.
  function lignesAchatDeReceptions(data, receptions) {
    const parCle = new Map(), out = [];
    (receptions || []).forEach(r => (r.lines || []).forEach(l => {
      const c = itemOfLine(l, data);
      const ligne = { label: l.label || '', qty: round3(Number(l.qty) || 0), unit: l.unit || '', unitPrice: Number(l.unitPrice) || 0, vatRate: Number(l.vatRate) || 0,
        destination: c && c.tracked ? 'stock' : 'charge', deductible: true, recue: true, ...(l.itemId ? { itemId: l.itemId } : {}) };
      const cle = Number.isInteger(l.ligneCommande) && r.orderId ? JSON.stringify([r.orderId, l.ligneCommande, ligne.label, ligne.unitPrice, ligne.vatRate]) : '';
      const deja = cle ? parCle.get(cle) : null;
      if (deja) { deja.qty = round3(deja.qty + ligne.qty); return; }
      // Sa ligne de commande (brique 88) : la facture se compare à ce qui a été reçu, ligne par ligne.
      if (cle) { ligne.origine = { commande: r.orderId, ligne: l.ligneCommande }; parCle.set(cle, ligne); }
      out.push(ligne);
    }));
    return out.filter(l => l.qty > 0);
  }
  // La copie d'une ligne d'achat (le bouton ⧉, la copie d'un achat) : aucune réception ne l'a reçue, sa
  // marchandise entre en stock comme celle de n'importe quelle ligne.
  function copieLigneAchat(l) {
    const x = JSON.parse(JSON.stringify(l || {}));
    delete x.recue;
    delete x.origine;
    return x;
  }
  // Les écarts entre la facture d'un fournisseur et ce que ses réceptions ont reçu (brique 88 ; 14 § 3.2 :
  // « un écart de quantité ou de prix se signale ») : une quantité facturée qui n'est pas la quantité reçue,
  // un prix qui n'est pas celui de la commande (seulement dans la même devise), une ligne reçue absente de
  // la facture. Ce n'est pas un refus : la facture s'enregistre telle que le fournisseur l'a émise.
  function ecartsAchatReceptions(data, p) {
    const ids = new Set((Array.isArray(p && p.receptions) ? p.receptions : []).map(x => x.id));
    const recs = (data.receptions || []).filter(r => ids.has(r.id) && r.status === 'validée');
    if (!recs.length) return [];
    const base = (data.company && data.company.currency) || 'DT';
    const memeDevise = (p.currency || base) === (recs[0].currency || base);
    const lignes = (p.lines || []).filter(l => l.recue);
    const out = [];
    lignesAchatDeReceptions(data, recs).forEach(a => {
      const l = a.origine ? lignes.find(x => x.origine && x.origine.commande === a.origine.commande && x.origine.ligne === a.origine.ligne)
        : lignes.find(x => !x.origine && (x.label || '') === a.label);
      const quoi = { label: a.label, unit: a.unit };
      if (!l) { out.push({ ...quoi, genre: 'absente', recu: a.qty }); return; }
      const q = round3(Number(l.qty) || 0);
      if (Math.abs(q - a.qty) > 0.0005) out.push({ ...quoi, genre: 'quantite', recu: a.qty, facture: q });
      const pu = Number(l.unitPrice) || 0;
      if (memeDevise && Math.abs(pu - a.unitPrice) > 0.0005) out.push({ ...quoi, genre: 'prix', commande: a.unitPrice, facture: pu });
    });
    return out;
  }
  // Les commandes fournisseurs en retard (brique 90) : envoyées ou reçues en partie, dont la livraison souhaitée
  // est passée. UNE fonction pour la ligne de « À faire » et la mention « en retard » de la liste qu'elle ouvre.
  function commandesFournisseurEnRetard(data, todayIso) {
    const t = todayIso || today();
    return (data.supplierOrders || []).filter(o => o.dueDate && o.dueDate < t && ['envoyée', 'partielle'].includes(statutCommandeFournisseur(data, o)));
  }
  // L'encours d'un client (brique 91 ; 14 § 3.2) : ce qu'il doit (le reste à payer de ses factures émises) et ce
  // qui lui est livré sans être facturé (ses bons à facturer, toutes taxes comprises), en dinars.
  function encoursClient(data, clientId, company) {
    const co = company || data.company || {};
    const du = round3((data.documents || []).filter(d => d.clientId === clientId && d.type === 'facture' && d.status !== 'brouillon' && d.status !== 'annulée')
      .reduce((s, d) => { const r = invoiceBalance(d, data, co).remaining; return s + (r > 0.0005 ? toBase(d, r, co) : 0); }, 0));
    const bons = bonsAFacturer(data).filter(b => b.clientId === clientId);
    const livre = round3(bons.reduce((s, b) => s + toBase(b, computeTotals(b, co).totalTTC, co), 0));
    return { du, livre, total: round3(du + livre), bons };
  }
  // Ce qu'une pièce à émettre ferait de l'encours de son client, s'il a un encours autorisé (`creditLimit`, en
  // dinars) : null sous le plafond. Une facture de bons déjà comptés comme livrés ne les compte pas deux fois.
  function depassementEncours(data, doc, company) {
    const co = company || data.company || {};
    const c = (data.clients || []).find(x => x.id === doc.clientId);
    const plafond = Number(c && c.creditLimit) || 0;
    // (1.309.0) Un avoir diminue l'encours : il ne le dépasse jamais. Compté comme une facture de plus, l'avoir de 5 m² de
    // carrelage annonçait avant l'émission « 1 948,770 DT au-delà de ce qui est permis pour ce client ».
    if (!plafond || !doc.clientId || doc.type === 'avoir') return null;
    const e = encoursClient(data, doc.clientId, co);
    const siens = new Set([...(Array.isArray(doc.bonsLivraison) ? doc.bonsLivraison.map(b => b.id) : []), doc.fromDocId].filter(Boolean));
    const dejaComptes = round3(e.bons.filter(b => siens.has(b.id) || b.id === doc.id).reduce((s, b) => s + toBase(b, computeTotals(b, co).totalTTC, co), 0));
    const piece = toBase(doc, doc.type === 'livraison' ? computeTotals(doc, co).totalTTC : computeTotals(doc, co).netToPay, co);
    const apres = round3(e.total - dejaComptes + piece);
    return apres > plafond + 0.0005 ? { plafond, encours: round3(e.total - dejaComptes), piece, apres, depasse: round3(apres - plafond) } : null;
  }
  // Une demande de prix envoyée à plusieurs fournisseurs (brique 89) : ses copies partagent un groupe (l'identifiant
  // de la première). Seules les demandes encore ouvertes comptent : une demande commandée ou écartée n'en est plus une.
  function demandesDuGroupe(data, d) {
    const g = d && (d.groupe || d.id);
    return (data.supplierOrders || []).filter(x => x.status === 'demande' && (x.groupe || x.id) === g);
  }
  // Comparer les réponses : ligne par ligne, le prix de chaque fournisseur ramené en dinars (une ligne sans prix
  // est sans réponse : elle ne gagne pas), et le total hors taxes de chaque demande entièrement répondue.
  function comparerDemandes(data, d) {
    const co = data.company || {};
    const ds = demandesDuGroupe(data, d);
    const n = Math.max(0, ...ds.map(x => (x.lines || []).length));
    const lignes = [];
    for (let i = 0; i < n; i++) {
      const ref = ds.map(x => (x.lines || [])[i]).find(Boolean) || {};
      const prix = ds.map(x => { const l = (x.lines || [])[i]; const pu = l ? Number(l.unitPrice) || 0 : 0; return pu > 0 ? toBase(x, pu, co) : null; });
      const vus = prix.filter(v => v !== null);
      const min = vus.length ? Math.min(...vus) : null;
      lignes.push({ label: ref.label || '', qty: Number(ref.qty) || 0, unit: ref.unit || '', prix, meilleur: min === null ? -1 : prix.indexOf(min) });
    }
    const totaux = ds.map(x => ({ id: x.id, supplierId: x.supplierId || '', number: x.number || '',
      complete: (x.lines || []).length > 0 && (x.lines || []).every(l => (Number(l.unitPrice) || 0) > 0),
      totalHT: toBase(x, computeTotals(x, co).netHT, co) }));
    const completes = totaux.filter(t => t.complete);
    const moinsCher = completes.length ? completes.reduce((a, b) => (b.totalHT < a.totalHT ? b : a)).id : null;
    return { demandes: ds, lignes, totaux, moinsCher };
  }

  // ---------- les commandes livrées en plusieurs fois (plateforme, brique 86 ; 14 § 3.2) ----------
  // Un grossiste livre une commande en plusieurs fois : le premier bon emporte ce qui est en stock, le
  // reliquat suit. Chaque ligne d'un bon tiré d'une commande garde le rang de SA ligne de commande
  // (`ligneCommande`) : ce qui est livré se compte ligne par ligne, par UNE fonction (`suiviCommande`),
  // que lisent le statut de la commande, son panneau « Livraisons », son menu et le bon suivant. Seul un
  // bon émis ou signé a livré ; un bon en brouillon est « en préparation » (le bon suivant ne le propose
  // pas une seconde fois) ; un bon annulé ne compte pas. Un bon tiré d'une commande avant ce rattachement
  // (aucune de ses lignes ne porte `ligneCommande`) se lit ligne à ligne : même rang, même désignation.
  const BON_LIVRE = ['émis', 'signé'];
  function bonsDeCommande(data, commande) {
    if (!commande || !commande.id) return [];
    const idx = duLot(data, 'bons-par-commande', () => {
      const m = new Map();
      (data.documents || []).forEach(d => {
        if (d.type !== 'livraison' || !d.fromDocId || /^annul/.test(d.status || '')) return;
        if (!m.has(d.fromDocId)) m.set(d.fromDocId, []);
        m.get(d.fromDocId).push(d);
      });
      return m;
    });
    return (idx.get(commande.id) || []).slice()
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0));
  }
  function suiviCommande(data, commande) {
    const source = (commande && commande.lines) || [];
    const lignes = source.map((l, i) => ({ i, label: l.label || '', unit: l.unit || '', commandee: round3(Number(l.qty) || 0), livree: 0, enPreparation: 0 }));
    const bons = bonsDeCommande(data, commande);
    bons.forEach(b => {
      const rattache = (b.lines || []).some(l => Number.isInteger(l.ligneCommande));
      (b.lines || []).forEach((l, j) => {
        const i = rattache ? l.ligneCommande : (source[j] && (source[j].label || '') === (l.label || '') ? j : null);
        const x = Number.isInteger(i) ? lignes[i] : null;
        if (!x) return;
        const q = round3(Number(l.qty) || 0);
        if (BON_LIVRE.includes(b.status)) x.livree = round3(x.livree + q);
        else if (b.status === 'brouillon') x.enPreparation = round3(x.enPreparation + q);
      });
    });
    lignes.forEach(x => {
      x.reste = round3(Math.max(0, x.commandee - x.livree));
      x.enPlus = round3(Math.max(0, x.livree - x.commandee));
      x.aProposer = round3(Math.max(0, x.commandee - x.livree - x.enPreparation));
    });
    const utiles = lignes.filter(x => x.commandee > 0);
    const toutLivre = utiles.length > 0 && utiles.every(x => x.reste <= 0);
    return {
      lignes, bons, brouillons: bons.filter(b => b.status === 'brouillon'),
      livree: toutLivre, partielle: !toutLivre && lignes.some(x => x.livree > 0),
      aProposer: utiles.some(x => x.aProposer > 0)
    };
  }
  // « Reste à livrer : Ciment gris (40 sac) » : la même phrase dans le menu de la commande et sur son panneau.
  function resteALivrerDit(s) {
    const r = ((s && s.lignes) || []).filter(x => x.aProposer > 0);
    if (!r.length) return '';
    const une = x => `${x.label || 'ligne sans désignation'} (${String(x.aProposer).replace('.', ',')}${x.unit ? ' ' + x.unit : ''})`;
    return r.length === 1 ? `Reste à livrer : ${une(r[0])}` : `Reste à livrer sur ${r.length} lignes : ${une(r[0])}, …`;
  }
  // Le bon de livraison d'une commande : ce qui reste à livrer, et rien d'autre (une ligne déjà partie, ou
  // dans un bon en préparation, ne revient pas). Rien à livrer : null.
  function livraisonDeCommande(data, commande, company, todayIso, client) {
    const s = suiviCommande(data, commande);
    const out = convertDoc(commande, 'livraison', company, todayIso, client);
    out.lines = (out.lines || []).map((l, i) => ({ ...l, qty: s.lignes[i] ? s.lignes[i].aProposer : 0, ligneCommande: i }))
      .filter(l => l.qty > 0);
    return out.lines.length ? out : null;
  }
  // Les bons qu'une facture regroupe : ceux qu'elle nomme, ou le bon dont elle est tirée.
  function bonsDeFacture(f) {
    if (!f || f.type !== 'facture') return [];
    if (Array.isArray(f.bonsLivraison) && f.bonsLivraison.length) return f.bonsLivraison;
    return f.fromDocType === 'livraison' && f.fromDocId ? [{ id: f.fromDocId, number: f.fromDocNumber || '' }] : [];
  }
  // La facture qui couvre un bon de livraison : celle qui le nomme, sinon une facture de la même vente (la
  // même origine, comme `chaineDePieces`) qui ne vient d'aucun bon — tirée du devis, de la proforma ou de
  // la commande, elle facture toute la vente. Une facture d'acompte ne facture pas la marchandise ; une
  // facture annulée ne couvre rien. L'index se construit une fois par lot (une liste de cent bons ne relit
  // pas cent fois toutes les pièces).
  function facturesDesBons(data) {
    return duLot(data, 'factures-des-bons', () => {
      const docs = data.documents || [];
      const parId = new Map(docs.map(d => [d.id, d]));
      const parent = x => x.fromDocId || x.fromQuoteId || (x.deposit && x.deposit.quoteId) || '';
      const racine = d => { let r = d; for (let i = 0; i < 50; i++) { const p = parent(r) && parId.get(parent(r)); if (!p || p.id === d.id) break; r = p; } return r.id; };
      const parBon = new Map(), parVente = new Map();
      docs.forEach(f => {
        if (f.type !== 'facture' || effectiveStatus(f, data, data.company) === 'annulée') return;
        const bons = bonsDeFacture(f);
        if (bons.length) bons.forEach(b => { if (!parBon.has(b.id)) parBon.set(b.id, f); });
        else if (!f.deposit) { const r = racine(f); if (!parVente.has(r)) parVente.set(r, f); }
      });
      return { parBon, parVente, racine };
    });
  }
  function factureDuBon(data, bon) {
    if (!bon || !bon.id) return null;
    const x = facturesDesBons(data);
    return x.parBon.get(bon.id) || x.parVente.get(x.racine(bon)) || null;
  }
  // Les bons émis ou signés qu'aucune facture ne couvre : de la marchandise partie sans être facturée.
  function bonsAFacturer(data) {
    return enLot(() => (data.documents || []).filter(d => d.type === 'livraison' && BON_LIVRE.includes(d.status) && !factureDuBon(data, d)));
  }
  // Une facture pour plusieurs bons de livraison d'un même client, dans une même devise : leurs lignes à la
  // suite, aux prix qu'ils portent (ceux de la commande), et les bons qu'elle regroupe, imprimés sur elle.
  // Elle naît brouillon, comme toute pièce tirée d'une autre ; tirée d'un bon, elle ne sort pas le stock
  // une seconde fois (ce sont les bons qui l'ont sorti). Des bons de clients ou de devises différents : null.
  // Une même ligne de commande livrée en plusieurs fois se facture en UNE ligne, sa quantité totale au même
  // prix : 2,5 t livrées 1,25 + 1,25 se factureraient sinon deux fois 2 938,438 — un millime de plus que la
  // commande (chaque ligne s'arrondit). Une ligne changée sur un bon (un autre prix) reste à part.
  function factureDeBons(bons, company, todayIso, client) {
    if (!bons || !bons.length) return null;
    const devise = b => b.currency || (company || {}).currency || '';
    if (bons.some(b => b.clientId !== bons[0].clientId || devise(b) !== devise(bons[0]))) return null;
    const out = convertDoc(bons[0], 'facture', company, todayIso, client);
    const objets = Array.from(new Set(bons.map(b => String(b.subject || '').trim()).filter(Boolean)));
    const refs = Array.from(new Set(bons.map(b => String(b.reference || '').trim()).filter(Boolean)));
    const parCle = new Map();
    out.lines = [];
    bons.forEach(b => JSON.parse(JSON.stringify(b.lines || [])).forEach(l => {
      const rang = l.ligneCommande;
      delete l.ligneCommande;
      const cle = Number.isInteger(rang) && b.fromDocId ? JSON.stringify([b.fromDocId, rang, { ...l, qty: 0 }]) : '';
      const deja = cle ? parCle.get(cle) : null;
      // (1.316.0) Chaque ligne dit de quel bon elle vient (`fromBon`) : elle a déjà quitté l'entrepôt avec lui. Une ligne
      // qu'on ajoute ensuite sur la facture (dix sacs pris au comptoir) n'en a pas, et sort le stock comme toute vente.
      if (deja) { deja.qty = round3((Number(deja.qty) || 0) + (Number(l.qty) || 0)); if (b.number && !String(deja.fromBon || '').split(', ').includes(b.number)) deja.fromBon = [deja.fromBon, b.number].filter(Boolean).join(', '); return; }
      l.fromBon = b.number || '';
      if (cle) parCle.set(cle, l);
      out.lines.push(l);
    }));
    out.subject = objets.join(' ; ');
    out.reference = refs.join(', ');
    out.bonsLivraison = bons.map(b => ({ id: b.id, number: b.number || '' }));
    delete out.hidePrices;
    return out;
  }

  // Clauses d'un contrat de prestation. Textes de départ, tous modifiables sur le document.
  // Ce sont des formulations courantes, pas un conseil juridique — À FAIRE RELIRE par un juriste ou le comptable.
  const DEFAULT_CLAUSES = {
    objet: 'Le prestataire s\'engage à réaliser pour le client les prestations décrites ci-dessus, dans les conditions définies au présent contrat.',
    duree: 'Le présent contrat est conclu pour une durée de douze (12) mois à compter de sa date de signature.',
    reconduction: 'À son terme, le contrat est reconduit tacitement pour des périodes successives de douze (12) mois, sauf dénonciation par l\'une des parties.',
    preavis: 'La dénonciation se fait par lettre recommandée avec accusé de réception, moyennant un préavis de trente (30) jours avant l\'échéance.',
    paiement: 'Les prestations sont facturées mensuellement et payables à trente (30) jours date de facture. Tout retard de paiement pourra entraîner la suspension des prestations.',
    confidentialite: 'Chaque partie s\'engage à garder confidentielle toute information de l\'autre partie dont elle aurait connaissance à l\'occasion du présent contrat.',
    litiges: 'En cas de litige, les parties s\'efforceront de trouver une solution amiable. À défaut, le différend sera porté devant les tribunaux compétents de Tunis.'
  };
  const CLAUSE_LABELS = [
    ['objet', 'Objet du contrat'], ['duree', 'Durée'], ['reconduction', 'Reconduction'], ['preavis', 'Résiliation et préavis'],
    ['paiement', 'Conditions de paiement'], ['confidentialite', 'Confidentialité'], ['litiges', 'Litiges']
  ];

  // ---------- statistiques ----------
  // Bornes d'une période nommée. `kind` : 'annee' | 'trimestre' | 'mois'. `n` = numéro du trimestre (1-4)
  // ou du mois (1-12). Renvoie aussi la même période de l'année précédente, pour la comparaison.
  function periodBounds(kind, year, n) {
    const y = Number(year);
    const last = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const make = (yy, m1, m2) => ({ from: `${yy}-${pad2(m1)}-01`, to: `${yy}-${pad2(m2)}-${pad2(last(yy, m2))}` });
    let cur, label;
    if (kind === 'mois') { const m = Math.min(12, Math.max(1, Number(n) || 1)); cur = make(y, m, m); label = `${MONTHS_FR[m - 1]} ${y}`; }
    else if (kind === 'trimestre') { const q = Math.min(4, Math.max(1, Number(n) || 1)); cur = make(y, q * 3 - 2, q * 3); label = `${q}ᵉ trimestre ${y}`; }
    else { cur = make(y, 1, 12); label = `année ${y}`; }
    const prev = kind === 'mois' ? make(y - 1, Number(n) || 1, Number(n) || 1)
      : kind === 'trimestre' ? make(y - 1, (Number(n) || 1) * 3 - 2, (Number(n) || 1) * 3)
        : make(y - 1, 1, 12);
    return { ...cur, label, prev, kind, year: y, n: Number(n) || 0 };
  }

  // Factures et avoirs émis d'une période, avoirs comptés en négatif. Base de tous les chiffres qui suivent.
  function issuedIn(data, fromIso, toIso) {
    return (data.documents || []).filter(d => (d.type === 'facture' || d.type === 'avoir')
      && d.status !== 'brouillon' && d.status !== 'annulée' && inPeriod(d.date, fromIso, toIso));
  }
  function salesTotals(data, company, fromIso, toIso) {
    const docs = issuedIn(data, fromIso, toIso);
    let ht = 0, ttc = 0, vat = 0;
    docs.forEach(d => {
      const t = computeTotals(d, company), sign = d.type === 'avoir' ? -1 : 1;
      ht = round3(ht + sign * toBase(d, t.netHT, company));
      ttc = round3(ttc + sign * toBase(d, t.totalTTC, company));
      vat = round3(vat + sign * toBase(d, t.totalVAT, company));
    });
    const invoices = docs.filter(d => d.type === 'facture').length;
    return { ht, ttc, vat, count: docs.length, invoices, avgTicket: invoices ? round3(ht / invoices) : 0 };
  }

  // CA HT mois par mois sur une période quelconque (sert au graphique et à la saisonnalité).
  function revenueByMonth(data, company, fromIso, toIso) {
    const out = [];
    let y = Number(fromIso.slice(0, 4)), m = Number(fromIso.slice(5, 7));
    const endY = Number(toIso.slice(0, 4)), endM = Number(toIso.slice(5, 7));
    let guard = 0;
    while ((y < endY || (y === endY && m <= endM)) && guard++ < 240) {
      out.push({ month: `${y}-${pad2(m)}`, label: MONTHS_SHORT[m - 1], ht: 0, count: 0 });
      m++; if (m > 12) { m = 1; y++; }
    }
    const byKey = Object.fromEntries(out.map(x => [x.month, x]));
    issuedIn(data, fromIso, toIso).forEach(d => {
      const k = (d.date || '').slice(0, 7);
      if (!byKey[k]) return;
      byKey[k].ht = round3(byKey[k].ht + (d.type === 'avoir' ? -1 : 1) * toBase(d, computeTotals(d, company).netHT, company));
      byKey[k].count++;
    });
    return out;
  }

  // Prestations les plus vendues sur la période, regroupées par libellé (les lignes de déduction d'acompte sont ignorées).
  function topItems(data, company, fromIso, toIso, limit) {
    const totals = {};
    issuedIn(data, fromIso, toIso).forEach(d => {
      const sign = d.type === 'avoir' ? -1 : 1;
      const tt = computeTotals(d, company);
      // La remise globale ampute le prix de chaque prestation (10.14.0) : sans elle, le « top » des
      // Statistiques additionnait les lignes AVANT remise, et disait d'une prestation vendue sur une
      // facture remisée plus que la page Marges, qui la compte depuis la 3.4.0 (`documentMargin`).
      const factor = facteurRemise(tt);
      tt.lines.forEach(l => {
        // Un acompte facturé, et sa déduction sur la facture de solde, sont du chiffre d'affaires de
        // LEUR mois — la règle de `marginBy` (10.14.0). Les ignorer faisait dire au « top » de mars
        // 340 DT quand la carte d'à côté annonçait 1 509 DT, et à celui de mai la prestation entière
        // quand le mois n'en facturait que le solde. Une ligne à part, comme sur la page Marges.
        if (l.noDiscount) {
          const t = totals.__acomptes__ || (totals.__acomptes__ = { label: 'Acomptes facturés (repris au solde)', ht: 0, qty: 0, count: 0, acomptes: true });
          t.ht = round3(t.ht + sign * toBase(d, l.ht, company));
          return;
        }
        const key = (l.label || '').trim().toLowerCase();
        if (!key) return;
        const t = totals[key] || (totals[key] = { label: (l.label || '').trim(), ht: 0, qty: 0, count: 0 });
        t.ht = round3(t.ht + sign * toBase(d, round3(l.ht * factor), company));
        t.qty = round3(t.qty + sign * (Number(l.qty) || 0));
        t.count++;
      });
    });
    // Un acompte et sa déduction dans la même période s'annulent : une ligne à zéro n'apprend rien.
    return Object.values(totals).filter(t => !t.acomptes || Math.abs(t.ht) > 0.0005).sort((a, b) => b.ht - a.ht).slice(0, limit || 8);
  }

  // (1.284.0, revue du Stock S5) Ce qu'un article s'est vendu sur la période : la quantité et le chiffre HT (remise
  // globale comprise, en devise de base), factures émises moins avoirs — la règle de `topItems`, mais par article (son
  // identifiant), pas par libellé : un article renommé reste le même.
  function ventesDeLArticle(data, company, itemId, fromIso, toIso) {
    let ht = 0, qty = 0, pieces = 0;
    issuedIn(data, fromIso, toIso).forEach(d => {
      const sign = d.type === 'avoir' ? -1 : 1;
      const tt = computeTotals(d, company);
      const factor = facteurRemise(tt);
      let vu = false;
      tt.lines.forEach(l => {
        if (l.noDiscount || l.itemId !== itemId) return;
        ht = round3(ht + sign * toBase(d, round3(l.ht * factor), company));
        qty = round3(qty + sign * (Number(l.qty) || 0));
        vu = true;
      });
      if (vu) pieces++;
    });
    return { ht, qty, pieces };
  }

  // Clients nouveaux sur la période (première facture dedans) et clients endormis (plus rien depuis `dormantDays`).
  function clientMovement(data, company, fromIso, toIso, dormantDays, todayIso) {
    const t = todayIso || today();
    const seuil = Number(dormantDays) || 180;
    const nouveaux = [], dormants = [];
    const inside = issuedIn(data, fromIso, toIso);
    // Les pièces se rangent par client UNE fois (10.14.0) : relire toutes les pièces pour chacun des
    // mille cinq cents clients coûtait un tiers de seconde à chaque ouverture des Statistiques.
    const parClient = new Map(), dedans = new Map();
    (data.documents || []).forEach(d => {
      if (!(d.type === 'facture' || d.type === 'avoir') || d.status === 'brouillon' || d.status === 'annulée' || !d.date) return;
      if (!parClient.has(d.clientId)) parClient.set(d.clientId, []);
      parClient.get(d.clientId).push(d.date);
    });
    inside.forEach(d => { if (!dedans.has(d.clientId)) dedans.set(d.clientId, []); dedans.get(d.clientId).push(d); });
    (data.clients || []).forEach(c => {
      const dates = (parClient.get(c.id) || []).slice().sort();
      if (!dates.length) return;
      const first = dates[0], last = dates[dates.length - 1];
      const ht = round3((dedans.get(c.id) || [])
        .reduce((s, d) => s + (d.type === 'avoir' ? -1 : 1) * toBase(d, computeTotals(d, company).netHT, company), 0));
      if (inPeriod(first, fromIso, toIso)) nouveaux.push({ clientId: c.id, name: c.name, since: first, ht });
      const idle = daysBetween(last, t);
      if (idle >= seuil) dormants.push({ clientId: c.id, name: c.name, last, days: idle });
    });
    return {
      nouveaux: nouveaux.sort((a, b) => b.ht - a.ht),
      dormants: dormants.sort((a, b) => b.days - a.days)
    };
  }

  // Âge des impayés : ce qui reste dû, rangé par retard. Un bon indicateur de ce qui part en créance douteuse.
  // Les tranches d'âge vivent dans `compta.js` depuis la 9.5.0 : le Cabinet en a besoin et ne
  // charge pas core.js. Deux définitions donneraient deux balances âgées qui ne disent pas la
  // même chose — c'est exactement ce que ce module partagé existe pour empêcher.
  const AGING_BUCKETS = Compta.AGING_BUCKETS;
  function agedReceivables(data, company, todayIso) {
    const t = todayIso || today();
    const buckets = AGING_BUCKETS.map(([min, max, label]) => ({ label, min, max, amount: 0, count: 0 }));
    let total = 0;
    (data.documents || []).filter(d => d.type === 'facture' && d.status !== 'brouillon' && d.status !== 'annulée').forEach(d => {
      const rest = invoiceBalance(d, data, company).remaining;
      if (rest <= 0.0005) return;
      const amount = round3(toBase(d, rest, company));
      const late = d.dueDate && d.dueDate < t ? daysBetween(d.dueDate, t) : 0;
      const b = buckets.find(x => late >= x.min && late <= x.max) || buckets[0];
      b.amount = round3(b.amount + amount); b.count++;
      total = round3(total + amount);
    });
    return { buckets, total };
  }

  // ---------- le relevé de compte d'un client (10.2.0) ----------
  // Le document qui manquait le plus au quotidien : « qu'est-ce que ce client me doit, en tout ? »
  // Une relance porte sur UNE facture ; un client qui en a six ouvertes reçoit six relances et
  // recompose le total lui-même — ou ne le fait pas. Le relevé est la pièce qu'on envoie à la
  // comptabilité d'en face pour qu'elle rapproche son compte du nôtre.
  //
  // Il ne se saisit pas et ne s'enregistre pas : il se DÉDUIT des pièces à l'instant où on
  // l'imprime, comme les statuts (règle « les statuts ne se saisissent jamais à la main »). Un
  // relevé rangé se périmerait à l'encaissement suivant.
  //
  // Le relevé qu'on ENVOIE (`opts.natif`, 10.14.1, DEV-12) parle la devise et la langue du client :
  // un client facturé en euros recevait « 3 190,202 DT » pour une facture de 952,30 €, en français,
  // et ne pouvait rapprocher aucune ligne de son compte. Quand toutes ses pièces sont dans UNE
  // devise, le relevé est dans cette devise ; quand elles en mêlent plusieurs, il reste dans celle de
  // la société et chaque pièce étrangère rappelle son montant d'origine. Sans `natif` (la fiche, le
  // menu), tout reste en devise de la société — c'est là qu'on additionne.
  function releveClient(data, clientId, company, opts) {
    opts = opts || {};
    const t = opts.date || today();
    const client = (data.clients || []).find(c => c.id === clientId) || {};
    const lignes = [];
    const base = normCurrency(company.currency || 'DT');
    const pieces = (data.documents || [])
      .filter(d => d.clientId === clientId && (d.type === 'facture' || d.type === 'avoir')
        && d.status !== 'brouillon' && d.status !== 'annulée' && d.date <= t);
    const devises = [...new Set(pieces.map(d => normCurrency(d.currency || base)))];
    const devise = opts.natif && devises.length === 1 ? devises[0] : base;
    const natif = devise !== base;
    const conv = (d, x) => natif ? round3(x) : toBase(d, x, company);
    const origine = (d, x) => opts.natif && !natif && normCurrency(d.currency || base) !== base ? money(x, normCurrency(d.currency)) : '';
    const lang = !opts.natif ? 'fr' : client.lang === 'en' || client.lang === 'fr' ? client.lang
      : pieces.length && pieces.every(d => d.lang === 'en') ? 'en' : (company.defaultLang === 'en' ? 'en' : 'fr');
    pieces
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .forEach(d => {
        if (d.type === 'avoir') {
          // Un avoir qui vient en déduction d'une facture est DÉJÀ compté dans le reste dû de cette
          // facture (`invoiceBalance`) : le remontrer ferait un relevé deux fois trop favorable.
          // Seul un avoir libre — non rattaché — est une somme que le client peut encore employer.
          if (d.creditOf) return;
          const natNet = computeTotals(d, company).netToPay;
          const net = round3(conv(d, natNet));
          if (net <= 0.0005) return;
          lignes.push({ id: d.id, type: 'avoir', date: d.date, number: d.number || '', dueDate: '',
            libelle: d.subject || '', montant: -net, regle: 0, reste: -net, retard: 0, origine: origine(d, -natNet) });
          return;
        }
        const b = invoiceBalance(d, data, company);
        // Une facture payée plus qu'elle ne vaut porte une somme due AU CLIENT (10.14.0) : le relevé
        // la sautait comme une facture soldée, et le total disait au client qu'il devait plus qu'en
        // réalité. Elle s'écrit comme un avoir libre : un montant qu'il peut encore employer.
        if (b.remaining < -0.0005) {
          const trop = round3(conv(d, -b.remaining));
          lignes.push({ id: d.id, type: 'tropPercu', date: d.date, number: d.number || '', dueDate: '',
            libelle: '', montant: -trop, regle: 0, reste: -trop, retard: 0, origine: origine(d, b.remaining) });
          return;
        }
        if (b.remaining <= 0.0005) return;
        const montant = round3(conv(d, b.totals.netToPay));
        const reste = round3(conv(d, b.remaining));
        lignes.push({
          id: d.id, type: 'facture', date: d.date, number: d.number || '', dueDate: d.dueDate || '',
          libelle: d.subject || '', montant, regle: round3(montant - reste), reste,
          retard: d.dueDate && d.dueDate < t ? daysBetween(d.dueDate, t) : 0, origine: origine(d, b.remaining)
        });
      });
    const somme = k => round3(lignes.reduce((s, l) => s + l[k], 0));
    const echu = round3(lignes.filter(l => l.retard > 0).reduce((s, l) => s + l.reste, 0));
    // Le relevé dit ce que le client VERSERA (le net) ; son compte chez lui, comme le nôtre, porte
    // aussi la retenue qu'il gardera pour l'État en payant (10.14.0). Elle se dit à part, pour que sa
    // comptabilité rapproche son 401 du total sans deviner d'où vient l'écart.
    const rsASubir = round3((data.documents || [])
      .filter(d => d.clientId === clientId && (d.type === 'facture' || d.type === 'avoir') && d.date <= t)
      .reduce((s, d) => s + retenueASubir(d, data, company, natif), 0));
    return {
      client, date: t, currency: devise, lang, lignes, rsASubir,
      montant: somme('montant'), regle: somme('regle'), total: somme('reste'),
      echu, aVenir: round3(somme('reste') - echu),
      plusAncien: lignes.reduce((n, l) => Math.max(n, l.retard), 0)
    };
  }

  // Le relevé imprimable. Un document à part, comme les pièces du personnel (5.1.0) : ce n'est pas
  // une facture, il ne porte ni numéro, ni TVA, ni timbre — l'y faire passer par `documentHtml`
  // lui donnerait des mentions légales qui n'ont rien à y faire.
  // Le mail qui accompagne le relevé, dans la langue et la devise du relevé (10.14.1, DEV-12) : il
  // disait « Solde restant dû : 3 190,202 DT » en français à un client facturé 952,30 € en anglais.
  function mailReleve(r, company) {
    const en = r.lang === 'en', cur = r.currency, nom = (company || {}).name || '';
    const m = n => money(n, cur, null, en ? 'en' : 'fr');
    const d = fmtDate(r.date);
    if (en) {
      return {
        subject: `Statement of account as at ${d} — ${nom}`,
        body: `Hello,\n\nPlease find attached the statement of your account as at ${d}.\n\n`
          + (r.total > 0.0005 ? `Balance due: ${m(r.total)}${r.echu > 0.0005 ? `, of which ${m(r.echu)} overdue` : ''}.\n\n`
            : r.total < -0.0005 ? `Your account shows a balance in your favour of ${m(-r.total)}.\n\n` : 'Your account is settled. Thank you for your trust.\n\n')
          + `If a payment crossed with this message, please disregard it.\n\nBest regards,\n${nom}`
      };
    }
    return {
      subject: `Relevé de compte au ${d} — ${nom}`,
      body: `Bonjour,\n\nVous trouverez ci-joint le relevé de votre compte au ${d}.\n\n`
        + (r.total > 0.0005 ? `Solde restant dû : ${m(r.total)}${r.echu > 0.0005 ? `, dont ${m(r.echu)} échu` : ''}.\n\n`
          : r.total < -0.0005 ? `Votre compte présente un solde en votre faveur de ${m(-r.total)}.\n\n` : 'Votre compte est soldé. Merci de votre confiance.\n\n')
        + `Si un règlement s'est croisé avec cet envoi, merci de ne pas en tenir compte.\n\nCordialement,\n${nom}`
    };
  }
  // Les mots du relevé, dans les deux langues des pièces (10.14.1, DEV-12).
  const RELEVE_MOTS = {
    fr: { titre: 'Relevé de compte', asof: 'Situation arrêtée au', date: 'Date', piece: 'Pièce', objet: 'Objet', echeance: 'Échéance',
      montant: 'Montant', regle: 'Réglé', reste: 'Reste dû', retard: n => `${n} j de retard`, total: 'Total dû au', faveur: 'Solde en votre faveur au',
      echu: 'Échu', aVenir: 'À échoir', solde: 'Aucune pièce ouverte à cette date : le compte est soldé. Merci de votre confiance.',
      virement: 'Règlement par virement :', rappel: 'Ce relevé ne remplace pas les factures qu\'il récapitule. Si un règlement s\'est croisé avec son envoi, merci de ne pas en tenir compte.',
      avoir: 'Avoir', trop: 'Trop-perçu à rendre', origine: 'pièce en', mf: 'MF' },
    en: { titre: 'Statement of account', asof: 'Balance as at', date: 'Date', piece: 'Document', objet: 'Subject', echeance: 'Due date',
      montant: 'Amount', regle: 'Paid', reste: 'Balance due', retard: n => `${n} day${n > 1 ? 's' : ''} overdue`, total: 'Total due as at', faveur: 'Balance in your favour as at',
      echu: 'Overdue', aVenir: 'Not yet due', solde: 'No open item at this date: the account is settled. Thank you for your trust.',
      virement: 'Payment by bank transfer:', rappel: 'This statement does not replace the invoices it summarises. If a payment crossed with it, please disregard it.',
      avoir: 'Credit note', trop: 'Overpayment to refund', origine: 'document in', mf: 'Tax ID' }
  };
  function releveHtml(releve, company, opts) {
    opts = opts || {};
    const r = releve;
    const cur = r.currency;
    const lang = r.lang === 'en' ? 'en' : 'fr';
    const W = RELEVE_MOTS[lang];
    const fmt = n => money(n, null, decimalsFor(cur), lang);
    const dt = fmtDate;   // la facture anglaise écrit aussi JJ/MM/AAAA
    const libelle = l => l.libelle || (l.type === 'avoir' ? W.avoir : l.type === 'tropPercu' ? W.trop : '');
    const ink = company.primaryColor || '#1b2430';
    const accent = company.accentColor || '#0f9d8f';
    const hex = accent.replace('#', '');
    const [rr, gg, bb] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    const tint = a => `rgba(${rr}, ${gg}, ${bb}, ${a})`;
    const c = r.client || {};
    return `<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="utf-8">
<title>${W.titre} — ${escapeHtml(c.name || '')}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: ${ink}; font-size: 10pt; line-height: 1.55; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; min-height: 297mm; padding: 18mm 18mm; background: #fff; display: flex; flex-direction: column; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; padding-bottom: 14px; border-bottom: 2px solid ${tint(0.35)}; }
  .co-name { font-size: 14pt; font-weight: 700; }
  .co-sub { font-size: 8pt; color: #6a7480; line-height: 1.5; }
  h1 { font-size: 15pt; letter-spacing: 1.2px; text-transform: uppercase; color: ${accent}; margin: 24px 0 4px; }
  .asof { font-size: 9pt; color: #6a7480; margin: 0 0 18px; }
  .who { margin: 0 0 18px; padding: 10px 14px; background: ${tint(0.07)}; border-inline-start: 3px solid ${accent}; border-radius: 0 6px 6px 0; }
  .who b { font-size: 11pt; }
  table.l { width: 100%; border-collapse: collapse; }
  table.l th { font-size: 8pt; text-transform: uppercase; letter-spacing: .6px; color: #6a7480; text-align: start; padding: 6px 7px; border-bottom: 1.5px solid ${tint(0.4)}; }
  table.l td { padding: 6px 7px; border-bottom: 1px solid #eef1f4; vertical-align: top; }
  table.l td.n, table.l th.n { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.late td { background: rgba(214, 69, 65, .06); }
  .lateflag { color: #b4322e; font-size: 8pt; }
  tr.tot td { border-top: 1.5px solid ${ink}; border-bottom: none; font-weight: 700; font-size: 11.5pt; padding-top: 9px; }
  .recap { margin-top: 16px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .recap div { border: 1px solid #e6eaee; border-radius: 8px; padding: 9px 12px; }
  .recap .k { font-size: 8pt; text-transform: uppercase; letter-spacing: .6px; color: #6a7480; }
  .recap .v { font-size: 12pt; font-weight: 700; font-variant-numeric: tabular-nums; }
  .pay { margin-top: 16px; font-size: 9pt; }
  .foot { margin-top: auto; padding-top: 10px; border-top: 1px solid #eef1f4; font-size: 7.5pt; color: #8b949e; text-align: center; }
</style></head>
<body><div class="page">
  <div class="head">
    <div><div class="co-name">${escapeHtml(company.name || '')}</div>
      <div class="co-sub">${escapeHtml(company.address || '').replace(/\n/g, '<br>')}
        ${company.matricule ? `<br>${W.mf} : ${escapeHtml(matriculeLisible(company.matricule))}` : ''}</div></div>
    <div class="co-sub" style="text-align:end">${company.phone ? escapeHtml(company.phone) + '<br>' : ''}${company.email ? escapeHtml(company.email) : ''}</div>
  </div>
  <h1>${W.titre}</h1>
  <p class="asof">${W.asof} ${dt(r.date)}${opts.stampText ? ' — ' + escapeHtml(opts.stampText) : ''}</p>
  <div class="who"><b>${escapeHtml(c.name || '')}</b>${c.matricule ? `<br>${W.mf} : ${escapeHtml(matriculeLisible(c.matricule))}` : ''}
    ${c.address ? '<br>' + escapeHtml(c.address).replace(/\n/g, '<br>') : ''}</div>
  ${r.lignes.length ? `<table class="l">
    <thead><tr><th>${W.date}</th><th>${W.piece}</th><th>${W.objet}</th><th>${W.echeance}</th><th class="n">${W.montant}</th><th class="n">${W.regle}</th><th class="n">${W.reste}</th></tr></thead>
    <tbody>
      ${r.lignes.map(l => `<tr class="${l.retard > 0 ? 'late' : ''}">
        <td>${dt(l.date)}</td>
        <td>${escapeHtml(l.number || '—')}</td>
        <td>${escapeHtml(libelle(l))}${l.origine ? `<div class="lateflag" style="color:#6a7480">${W.origine} ${escapeHtml(l.origine)}</div>` : ''}</td>
        <td>${l.dueDate ? dt(l.dueDate) : '—'}${l.retard > 0 ? `<div class="lateflag">${W.retard(l.retard)}</div>` : ''}</td>
        <td class="n">${fmt(l.montant)}</td>
        <td class="n">${l.regle ? fmt(l.regle) : '—'}</td>
        <td class="n">${fmt(l.reste)}</td></tr>`).join('')}
      ${/* Un compte qui penche en faveur du client le DIT (10.14.0) : « Total dû : −505,560 » se lit
         comme une faute de frappe, et c'est le client qui la lit. */''}<tr class="tot"><td colspan="6">${r.total < -0.0005 ? W.faveur : W.total} ${dt(r.date)}</td><td class="n">${fmt(Math.abs(r.total))} ${escapeHtml(cur)}</td></tr>
    </tbody></table>
  ${r.total < -0.0005 ? '' : `<div class="recap">
    <div><div class="k">${W.echu}</div><div class="v">${fmt(r.echu)} ${escapeHtml(cur)}</div></div>
    <div><div class="k">${W.aVenir}</div><div class="v">${fmt(r.aVenir)} ${escapeHtml(cur)}</div></div>
  </div>`}`
    : `<p>${W.solde}</p>`}
  ${r.total > 0.0005 && company.rib ? `<p class="pay">${W.virement} <b>${escapeHtml(company.rib)}</b>${company.bank ? ' — ' + escapeHtml(company.bank) : ''}</p>` : ''}
  <p class="pay">${W.rappel}</p>
  <div class="foot">${escapeHtml(company.name || '')}${company.matricule ? ` — ${W.mf} ` + escapeHtml(matriculeLisible(company.matricule)) : ''}</div>
</div></body></html>`;
  }

  // Classement des payeurs : délai moyen constaté par client, sur ses factures soldées.
  function payerRanking(data, company, limit) {
    const out = [];
    (data.clients || []).forEach(c => {
      const delays = [];
      (data.documents || []).filter(d => d.type === 'facture' && d.clientId === c.id && d.status !== 'brouillon' && d.status !== 'annulée').forEach(d => {
        if (effectiveStatus(d, data, company, '9999-12-31') !== 'payée' || !(d.payments || []).length) return;
        const last = dateDernierReglement(d);
        if (last && d.date) delays.push(delaiConstate(d.date, last));
      });
      if (delays.length) out.push({ clientId: c.id, name: c.name, delay: Math.round(delays.reduce((s, x) => s + x, 0) / delays.length), count: delays.length });
    });
    out.sort((a, b) => a.delay - b.delay);
    // 10.12.0 — un client ne peut pas être à la fois parmi les plus rapides et les plus lents : avec
    // un seul payeur, la page le rangeait dans les deux colonnes, « 0 j » des deux côtés. Les rapides
    // prennent la première moitié, les lents ce qui reste.
    const k = limit || 5;
    const rapides = out.slice(0, Math.min(k, Math.ceil(out.length / 2)));
    return { rapides, lents: out.slice(rapides.length).reverse().slice(0, k), tous: out };
  }

  // Devis de la période : issue de chacun, montants gagnés et perdus, délai moyen de réponse.
  function quoteFunnel(data, company, fromIso, toIso, todayIso) {
    const t = todayIso || today();
    const quotes = (data.documents || []).filter(d => d.type === 'devis' && d.status !== 'brouillon' && inPeriod(d.date, fromIso, toIso));
    const amount = d => toBase(d, computeTotals(d, company).totalTTC, company);
    const sum = list => round3(list.reduce((s, d) => s + amount(d), 0));
    const accepted = quotes.filter(d => d.status === 'accepté');
    const refused = quotes.filter(d => d.status === 'refusé');
    const expired = quotes.filter(d => effectiveStatus(d, data, company, t) === 'expiré');
    const pending = quotes.filter(d => d.status !== 'accepté' && d.status !== 'refusé' && effectiveStatus(d, data, company, t) !== 'expiré');
    // Délai de réponse : on n'a pas de date de décision, on prend la date de la facture qui en découle.
    const delays = [];
    accepted.forEach(q => {
      const inv = (data.documents || []).filter(d => d.type === 'facture' && d.fromQuoteId === q.id).map(d => d.date).filter(Boolean).sort()[0];
      if (inv && q.date) delays.push(delaiConstate(q.date, inv));
    });
    const decided = accepted.length + refused.length;
    return {
      total: quotes.length,
      accepted: accepted.length, refused: refused.length, expired: expired.length, pending: pending.length,
      acceptedAmount: sum(accepted), refusedAmount: sum(refused), expiredAmount: sum(expired), pendingAmount: sum(pending),
      rate: decided ? Math.round(accepted.length / decided * 100) : null,
      replyDelay: delays.length ? Math.round(delays.reduce((s, x) => s + x, 0) / delays.length) : null
    };
  }

  // Objectif annuel : où on en est, et où on devrait en être à cette date de l'année.
  function objectiveProgress(target, ht, todayIso, year) {
    const goal = Number(target) || 0;
    if (goal <= 0) return null;
    const t = todayIso || today();
    const y = Number(year) || Number(t.slice(0, 4));
    const elapsed = Number(t.slice(0, 4)) > y ? 366 : Number(t.slice(0, 4)) < y ? 0 : daysBetween(`${y}-01-01`, t) + 1;
    const yearDays = daysBetween(`${y}-01-01`, `${y}-12-31`) + 1;
    const part = Math.min(1, Math.max(0, elapsed / yearDays));
    const expected = round3(goal * part);
    const months = Math.max(1, Math.round((1 - part) * 12));
    return {
      goal, ht, pct: Math.round(ht / goal * 100), expected, expectedPct: Math.round(part * 100),
      ahead: round3(ht - expected), remaining: round3(Math.max(0, goal - ht)),
      perMonth: round3(Math.max(0, goal - ht) / months), monthsLeft: months
    };
  }

  // ---------- (1.296.0) la revue des Statistiques ----------
  // Le chiffre d'affaires d'une période partagé entre les factures et le comptoir : la même assiette que `salesTotals`
  // (factures et avoirs émis, avoirs en moins, en devise de base), coupée en deux. Un ticket de caisse est une facture
  // marquée `ticket` ; l'avoir d'un retour au comptoir porte le ticket dans `creditOf` : il compte au comptoir. Le panier
  // moyen d'une épicerie se compte par ticket, celui d'un bureau d'études par facture : les deux ne se mélangent plus.
  function ventesParCanal(data, company, fromIso, toIso) {
    const tickets = new Set((data.documents || []).filter(estTicket).map(d => d.id));
    const z = () => ({ ht: 0, pieces: 0, avoirs: 0 });
    const out = { factures: z(), comptoir: z() };
    issuedIn(data, fromIso, toIso).forEach(d => {
      const k = estTicket(d) || (d.type === 'avoir' && tickets.has(d.creditOf)) ? out.comptoir : out.factures;
      k.ht = round3(k.ht + (d.type === 'avoir' ? -1 : 1) * toBase(d, computeTotals(d, company).netHT, company));
      if (d.type === 'avoir') k.avoirs++; else k.pieces++;
    });
    out.factures.panier = out.factures.pieces ? round3(out.factures.ht / out.factures.pieces) : 0;
    out.comptoir.panier = out.comptoir.pieces ? round3(out.comptoir.ht / out.comptoir.pieces) : 0;
    return out;
  }

  // Ce qui est entré en caisse et en banque sur la période : les règlements des factures et des tickets DATÉS de la
  // période (l'argent rendu au comptoir, un règlement négatif, en moins), en dinars reçus. La même liste que le journal
  // des encaissements (`paymentsJournal`) : deux écrans qui montrent la même chose disent le même chiffre.
  function encaisseSur(data, company, fromIso, toIso) {
    const rows = paymentsJournal(data, company, { from: fromIso, to: toIso });
    return { montant: round3(rows.reduce((s, r) => s + r.amount, 0)), reglements: rows.length };
  }

  // Ce que l'entreprise a acheté sur la période, rangé par fournisseur et par catégorie : la répartition que la liste des
  // achats ne montre plus (Skander, 30/10/2026 : « les répartitions iront à la page Statistiques »). Le HT de chaque
  // pièce en devise de base, signé par `base` (un avoir en moins, règle 6.3.0). Un acompte versé n'est pas un achat :
  // sa facture le reprend en entier (la règle de `coutAchat`) ; le compter ferait acheter deux fois.
  function achatsRepartis(data, company, fromIso, toIso) {
    const noms = new Map((data.suppliers || []).map(s => [s.id, s.name || '—']));
    const parF = new Map(), parC = new Map();
    let ht = 0, pieces = 0;
    (data.purchases || []).forEach(p => {
      if (p.kind === 'acompte' || !inPeriod(p.date, fromIso, toIso)) return;
      const v = purchaseTotals(p, company).base.totalHT;
      ht = round3(ht + v); pieces++;
      const kf = p.supplierId || '';
      const f = parF.get(kf) || { supplierId: kf, label: kf ? noms.get(kf) || '—' : 'Sans fournisseur', ht: 0, pieces: 0 };
      f.ht = round3(f.ht + v); f.pieces++; parF.set(kf, f);
      const cat = String(p.category || '').trim();
      const kc = cat.toLowerCase();
      const c = parC.get(kc) || { label: cat || 'Sans catégorie', ht: 0, pieces: 0 };
      c.ht = round3(c.ht + v); c.pieces++; parC.set(kc, c);
    });
    const tri = m => [...m.values()].sort((a, b) => b.ht - a.ht || a.label.localeCompare(b.label, 'fr'));
    return { ht, pieces, fournisseurs: tri(parF), categories: tri(parC) };
  }

  // Pourquoi les devis de la période ont été refusés : le motif noté avec la réponse du client (« Trop cher », « Un
  // concurrent »… ou ce qu'on a écrit), regroupé sans tenir compte des majuscules ; un refus sans motif se compte à part.
  // Quatre « trop cher » sur six refus disent quelque chose du prix ; c'est ce que le taux d'acceptation ne dit pas.
  function motifsDeRefus(data, company, fromIso, toIso) {
    const m = new Map();
    (data.documents || []).filter(d => d.type === 'devis' && d.status === 'refusé' && inPeriod(d.date, fromIso, toIso)).forEach(d => {
      const brut = String((d.reponse && d.reponse.motif) || '').trim();
      const k = brut.toLowerCase();
      const x = m.get(k) || { label: brut || 'Sans motif noté', sans: !brut, count: 0, ttc: 0 };
      x.count++; x.ttc = round3(x.ttc + toBase(d, computeTotals(d, company).totalTTC, company));
      m.set(k, x);
    });
    return [...m.values()].sort((a, b) => (a.sans - b.sans) || b.count - a.count || b.ttc - a.ttc);
  }

  // ---------- relances ----------

  function reminderLevel(daysLate) { return daysLate > 45 ? 3 : daysLate > 15 ? 2 : 1; }
  const REMINDER_LABELS = { 1: 'Rappel', 2: 'Relance', 3: 'Dernière relance' };

  function daysBetween(fromIso, toIso) { return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86400000); }

  // Factures échues (ou partiellement payées et échues), avec jours de retard et dernière relance.
  // `snoozed` : l'utilisateur a demandé de ne pas relancer avant une date (doc.remindAfter).
  // (1.312.0) Une facture EN RETARD : émise, ni brouillon ni annulée, échue et pas soldée, payée en partie ou non. La règle
  // des Relances, lue aussi par la liste des factures : sa tuile « En retard » comptait la seule facture au statut « retard »
  // (1 064,860 DT) là où l'accueil, les Relances et les Clients en comptaient deux (1 800,916 DT) ; `reste` est celui de
  // `invoiceBalance`, dans la devise de la facture.
  function factureEnRetard(d, reste, todayIso) {
    return !!d && d.type === 'facture' && d.status !== 'brouillon' && d.status !== 'annulée' && !!d.dueDate && d.dueDate < (todayIso || today()) && reste > 0.0005;
  }
  function overdueInvoices(data, company, todayIso) {
    const t = todayIso || today();
    return (data.documents || [])
      .filter(d => d.type === 'facture' && d.dueDate && d.dueDate < t)
      .map(d => ({ doc: d, balance: invoiceBalance(d, data, company), status: effectiveStatus(d, data, company, t) }))
      .filter(x => factureEnRetard(x.doc, x.balance.remaining, t))
      .map(x => {
        const daysLate = daysBetween(x.doc.dueDate, t);
        const reminders = x.doc.reminders || [];
        const last = reminders.length ? reminders[reminders.length - 1] : null;
        const snoozed = !!(x.doc.remindAfter && x.doc.remindAfter > t);
        // (1.293.0) Relancée il y a moins de RELANCE_ATTENTE jours : on attend la réponse. La facture reste en retard, mais
        // elle sort de « À relancer » jusqu'au jour où on la remontre (le lendemain du délai) : relancer deux fois la même
        // semaine, c'est harceler un client qui a peut-être déjà payé. Un report (snoozed) l'emporte sur l'attente.
        const remontre = last && last.date ? addDays(last.date, RELANCE_ATTENTE) : '';
        const attente = !snoozed && !!remontre && remontre > t;
        return { doc: x.doc, remaining: x.balance.remaining, daysLate, level: reminderLevel(daysLate), reminders, lastReminder: last, status: x.status, snoozed, remindAfter: x.doc.remindAfter || '', attente, remontre: attente ? remontre : '' };
      })
      .sort((a, b) => (a.snoozed ? 1 : 0) - (b.snoozed ? 1 : 0) || b.daysLate - a.daysLate);
  }
  const RELANCE_ATTENTE = 7;
  // Ce qu'il faut relancer AUJOURD'HUI : ni reporté, ni relancé il y a moins d'une semaine. Le chiffre du menu, celui de
  // la page et sa liste passent tous par ici (un compteur et la liste qu'il annonce : la même fonction).
  const aRelancer = x => !x.snoozed && !x.attente;

  // (1.293.0) Les factures à relancer, rangées par client : un client qui en doit trois reçoit UN message, pas trois.
  // Chaque groupe : le client, ses factures (de la plus en retard à la moins), le reste dû en devise de base, le plus grand
  // retard et son ton, la dernière relance faite sur l'une d'elles.
  function relancesParClient(items, company) {
    const parClient = new Map();
    items.forEach(x => {
      const k = x.doc.clientId || '';
      if (!parClient.has(k)) parClient.set(k, []);
      parClient.get(k).push(x);
    });
    return [...parClient.entries()].map(([clientId, liste]) => {
      const factures = liste.slice().sort((a, b) => b.daysLate - a.daysLate);
      const devises = [...new Set(factures.map(x => x.doc.currency || (company || {}).currency || 'DT'))];
      const derniere = factures.map(x => x.lastReminder).filter(Boolean).sort((a, b) => (a.date || '').localeCompare(b.date || '')).pop() || null;
      return {
        clientId, factures, devises,
        reste: round3(factures.reduce((s, x) => s + toBase(x.doc, x.remaining, company), 0)),
        retard: factures[0].daysLate, level: Math.max(...factures.map(x => x.level)), derniere
      };
    }).sort((a, b) => b.retard - a.retard || b.reste - a.reste);
  }

  // (1.293.0) Le message d'une relance groupée : une ligne par facture (numéro, date, échéance, reste, retard), le total
  // quand elles sont dans la même devise, au ton du plus grand retard. Jamais de taux ni de pénalité inventés : le texte
  // rappelle ce qui est dû, rien de plus.
  function relanceGroupee(factures, client, company, level) {
    const en = ((client || {}).lang || (company || {}).defaultLang) === 'en';
    const nom = (company || {}).name || '';
    const lang = en ? 'en' : 'fr';
    const devises = [...new Set(factures.map(x => x.doc.currency || (company || {}).currency || 'DT'))];
    const m = x => money(x.remaining, x.doc.currency || (company || {}).currency, null, lang);
    const lignes = factures.map(x => en
      ? `- ${x.doc.number} of ${fmtDate(x.doc.date)}, due ${fmtDate(x.doc.dueDate)}: ${m(x)} (${x.daysLate} day${x.daysLate > 1 ? 's' : ''} overdue)`
      : `- ${x.doc.number} du ${fmtDate(x.doc.date)}, échue le ${fmtDate(x.doc.dueDate)} : ${m(x)} (${x.daysLate} jour${x.daysLate > 1 ? 's' : ''} de retard)`).join('\n');
    const total = devises.length === 1 ? money(round3(factures.reduce((s, x) => s + x.remaining, 0)), devises[0], null, lang) : '';
    const n = factures.length;
    // « Malgré nos précédentes relances » ne se dit que s'il y en a eu : le ton ferme vient du retard, pas d'un historique
    // qu'on inventerait.
    const dejaRelance = factures.some(x => (x.reminders || []).length);
    if (en) {
      const intro = level >= 3 ? (dejaRelance ? `Despite our previous reminders, the following invoice${n > 1 ? 's remain' : ' remains'} unpaid:` : `The following invoice${n > 1 ? 's are' : ' is'} now long overdue and still unpaid:`)
        : level === 2 ? `Unless we are mistaken, the following invoice${n > 1 ? 's have' : ' has'} not been paid yet:`
        : `This is a friendly reminder that the following invoice${n > 1 ? 's are' : ' is'} past due:`;
      const fin = level >= 3 ? 'Please settle this amount within 8 days, or contact us to agree on a date.'
        : 'Could you let us know when payment is planned?';
      return { subject: `${level >= 3 ? 'Final reminder' : level === 2 ? 'Reminder' : 'Payment reminder'}: ${n} unpaid invoice${n > 1 ? 's' : ''} — ${nom}`,
        body: `Hello,\n\n${intro}\n${lignes}\n${total ? `\nTotal due: ${total}.\n` : ''}\n${fin}\nIf a payment crossed with this message, please disregard it.\n\nBest regards,\n${nom}` };
    }
    const intro = level >= 3 ? (dejaRelance ? `Malgré nos précédentes relances, ${n > 1 ? 'ces factures restent impayées' : 'cette facture reste impayée'} :` : `${n > 1 ? 'Ces factures sont échues depuis longtemps et restent impayées' : 'Cette facture est échue depuis longtemps et reste impayée'} :`)
      : level === 2 ? `Sauf erreur de notre part, ${n > 1 ? 'ces factures n\'ont' : 'cette facture n\'a'} pas encore été réglée${n > 1 ? 's' : ''} :`
      : `Petit rappel : ${n > 1 ? 'ces factures sont arrivées' : 'cette facture est arrivée'} à échéance :`;
    const fin = level >= 3 ? 'Merci de procéder au règlement sous 8 jours, ou de nous contacter pour convenir d\'une date.'
      : 'Pouvez-vous nous indiquer la date de règlement prévue ?';
    return { subject: `${REMINDER_LABELS[Math.min(3, Math.max(1, level))]} : ${n} facture${n > 1 ? 's' : ''} en attente de règlement — ${nom}`,
      body: `Bonjour,\n\n${intro}\n${lignes}\n${total ? `\nTotal dû : ${total}.\n` : ''}\n${fin}\nSi un règlement s'est croisé avec ce message, merci de ne pas en tenir compte.\n\nCordialement,\n${nom}` };
  }

  // Les factures qui restent dues mais ne sont PAS encore en retard, de la plus proche échéance à la
  // plus lointaine (10.12.0). La page Relances vide disait comment elle se remplit, jamais POURQUOI
  // elle était vide ni QUAND elle cesserait de l'être — à une menuiserie qui attendait 4 530 DT. Une
  // phrase d'état vide dit sa raison et le jour où ça changera (E-06) : ce jour-là est ici. Même
  // filtre que `overdueInvoices`, de l'autre côté de l'échéance ; une facture sans échéance n'est
  // jamais « à venir » : elle ne sera jamais en retard non plus.
  function facturesAVenir(data, company, todayIso) {
    const t = todayIso || today();
    return (data.documents || [])
      .filter(d => d.type === 'facture' && d.status !== 'brouillon' && d.status !== 'annulée' && d.dueDate && d.dueDate >= t)
      .map(d => ({ doc: d, remaining: invoiceBalance(d, data, company).remaining, dueDate: d.dueDate }))
      .filter(x => x.remaining > 0.0005)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.doc.number || '').localeCompare(b.doc.number || ''));
  }

  // ---------- les licences émises par l'éditeur (7.33.0) ----------
  //
  // L'éditeur de SkanFact vend des licences depuis SA propre application : la vente est une facture
  // comme une autre (journal des ventes, TVA, paquet du comptable), et l'historique vit ici, dans
  // `data.licences`. Chaque ligne garde la clé signée (elle n'a rien de secret : c'est celle qu'a
  // le client), l'offre, la date de fin, et la facture qui l'a portée.
  const LICENCE_PREAVIS = 30;   // jours avant l'échéance où une licence passe « à renouveler »
  // L'état d'une licence émise, vu de l'éditeur : 'vie' (sans fin), 'active', 'bientot' (elle finit
  // dans les trente jours — c'est le moment de facturer le renouvellement), 'expiree'.
  function licenceEtat(lic, todayIso) {
    const t = todayIso || today();
    // Une licence révoquée passe avant tout le reste : elle n'est plus ni active, ni à renouveler,
    // et surtout elle ne doit plus rien réclamer (8.2.0). Ce que la révocation ne fait PAS, c'est
    // désactiver la clé chez le client — voir `licenceRevoquee` et la phrase qui l'accompagne.
    if (lic && lic.revoqueeLe) return { etat: 'revoquee', jours: null };
    if (!lic || !lic.exp) return { etat: 'vie', jours: null };
    const jours = daysBetween(t, lic.exp);
    return { etat: jours < 0 ? 'expiree' : jours <= LICENCE_PREAVIS ? 'bientot' : 'active', jours };
  }
  const LICENCE_ETAT_LABELS = { vie: 'À vie', active: 'Active', bientot: 'À renouveler', expiree: 'Expirée', revoquee: 'Révoquée' };
  // Pourquoi une licence a été remplacée. Un renouvellement, un changement d'offre et une correction
  // de matricule fabriquent tous une clé neuve — l'offre et le matricule voyagent DANS la charge
  // signée, on ne peut pas les changer sans re-signer — mais ce ne sont pas le même geste, et la
  // liste mentirait en les montrant tous comme « renouvelée ».
  const LICENCE_MOTIFS = { renouvellement: 'Renouvelée', offre: 'Offre changée', matricule: 'Matricule corrigé' };

  // Le prorata d'un changement d'offre. On ne refait pas une année : on facture la DIFFÉRENCE de
  // prix sur les jours qui restent, et la date de fin ne bouge pas. Sans ça, passer d'Indépendant à
  // Entreprise au sixième mois coûterait une année pleine au client — ce qui est un très bon moyen
  // de lui faire refuser la montée en gamme.
  //   `total` : la durée de la licence en cours, du jour d'émission à la date de fin.
  //   `jours` : ce qui reste à courir depuis aujourd'hui.
  // Une licence à vie n'a pas de prorata : la différence se facture en entier (il n'y a pas de fin
  // sur laquelle répartir), et `jours`/`total` valent null pour que l'écran le dise au lieu
  // d'afficher un ratio inventé.
  function prorataOffre(lic, prixNouveau, prixAncien, todayIso) {
    const t = todayIso || today();
    const diff = Math.max(0, (Number(prixNouveau) || 0) - (Number(prixAncien) || 0));
    if (!lic || !lic.exp) return { jours: null, total: null, part: 1, montant: round3(diff) };
    const total = Math.max(1, daysBetween(lic.emisLe || t, lic.exp));
    const jours = Math.max(0, daysBetween(t, lic.exp));
    const part = Math.min(1, jours / total);
    return { jours, total, part, montant: round3(diff * part) };
  }

  // Ce qu'on sait d'une licence côté ARGENT et côté ENVOI. Deux questions que la page posait
  // nulle part : la clé est-elle partie, et la vente est-elle facturée puis encaissée ? Une licence
  // émise, jamais envoyée et jamais facturée est le pire des cas — le client attend, et la vente
  // n'existe pour personne.
  // `company` est un TROISIÈME argument chez `invoiceBalance` et `effectiveStatus`, jamais lu dans
  // `data` : l'oublier ne lève rien ici mais fait planter `computeTotals` sur `company.stampFee`.
  // On le laisse facultatif avec un repli sur `data.company`, qui est bien la société du dossier.
  function licenceSuivi(lic, data, company) {
    const co = company || (data && data.company) || {};
    const envois = (lic && lic.emails) || [];
    const inv = lic && lic.invoiceId ? (data.documents || []).find(d => d.id === lic.invoiceId) : null;
    const emise = !!(inv && inv.number);
    const st = inv && emise ? effectiveStatus(inv, data, co) : '';
    const reste = inv && emise ? invoiceBalance(inv, data, co).remaining : 0;
    // Une licence vendue par la CONSOLE (8.7.0, `origine: 'console'`) a été envoyée par elle, et
    // c'est elle qui le sait : la date arrive avec la vente, et compte comme un envoi.
    const envoyeeConsole = (lic && lic.origine === 'console' && lic.envoyeeConsoleLe) || '';
    return {
      envoyee: envois.length > 0 || !!envoyeeConsole,
      envoyeeLe: envois.length ? envois[envois.length - 1].date : envoyeeConsole,
      envois: envois.length,
      facture: inv || null, brouillon: !!(inv && !emise), facturee: emise,
      statutFacture: st, reste, payee: emise && reste <= 0
    };
  }

  // Les trois manques que « À faire » doit remonter, dans cet ordre de gravité. Une licence
  // révoquée n'y figure jamais : on ne réclame pas l'argent qu'on vient de rendre.
  // L'export de la base de la console : depuis combien de jours, et faut-il le réclamer ?
  // Réclamé au bout de trente jours — et tout de suite s'il n'a JAMAIS eu lieu, parce que « jamais »
  // n'est pas un retard, c'est un filet qui n'existe pas.
  const EXPORT_CONSOLE_DELAI = 30;
  function exportConsoleAFaire(data, todayIso) {
    const t = todayIso || today();
    const du = String((data && data.exportConsole) || '').slice(0, 10);
    if (!du) return { du: '', jours: null, reclame: true };
    const jours = daysBetween(du, t);
    return { du, jours, reclame: jours > EXPORT_CONSOLE_DELAI };
  }

  function licencesAFaire(data, company, todayIso) {
    const t = todayIso || today();
    const vivantes = (data.licences || []).filter(l => l && !l.revoqueeLe && !l.remplaceePar);
    // L'envoi d'une clé vendue par la console est l'affaire de la console (elle l'envoie au
    // paiement) : la réclamer ici ferait envoyer deux fois, ou avant que le client ait payé.
    const jamaisEnvoyees = vivantes.filter(l => l.origine !== 'console' && !licenceSuivi(l, data, company).envoyee);
    const nonFacturees = vivantes.filter(l => { const s = licenceSuivi(l, data, company); return !s.facturee; });
    const impayees = vivantes.filter(l => { const s = licenceSuivi(l, data, company); return s.facturee && !s.payee; });
    return { jamaisEnvoyees, nonFacturees, impayees, expirant: licencesExpirant(data, t) };
  }
  // Les lignes de la page Licences : ce qui presse d'abord (à renouveler, puis expirées), puis les
  // actives par date de fin, puis celles à vie. Une licence renouvelée pointe sur sa remplaçante
  // (`remplaceePar`) : elle sort du compte des choses à faire.
  function licenceRows(data, todayIso, company) {
    const t = todayIso || today();
    const ordre = { bientot: 0, expiree: 1, active: 2, vie: 3, revoquee: 4 };
    return (data.licences || []).map(l => {
      const e = licenceEtat(l, t);
      const suivi = licenceSuivi(l, data, company);
      return { ...l, etat: e.etat, jours: e.jours, etatLabel: LICENCE_ETAT_LABELS[e.etat],
        renouvelee: !!l.remplaceePar, motifLabel: l.remplaceePar ? (LICENCE_MOTIFS[l.motif] || LICENCE_MOTIFS.renouvellement) : '',
        envoyee: suivi.envoyee, envoyeeLe: suivi.envoyeeLe, facturee: suivi.facturee, payee: suivi.payee, resteDu: suivi.reste };
    }).sort((a, b) => (ordre[a.etat] - ordre[b.etat]) || ((a.exp || '9999').localeCompare(b.exp || '9999')) || (a.nom || '').localeCompare(b.nom || ''));
  }
  // ---------- le pont comptable (8.7.0) ----------
  //
  // La console (api.skanfact.tn) vend ; SkanFact facture. Trois choses pures ici, testées sans
  // Electron : retrouver le client d'une vente, la liste exacte de ce que l'historique envoie UNE
  // fois à la console, et les factures dont le numéro est à rendre.

  // Le client d'une vente de la console : par les sept chiffres du matricule d'abord (un matricule
  // s'écrit de dix façons — « MF 1234567A », « 1234567/A/M/000 »), par le nom ensuite, jamais créé
  // ici : créer est une décision de l'appelant.
  const chiffresMatricule = s => { const m = String(s || '').toUpperCase().match(/\d{7}/); return m ? m[0] : ''; };
  function clientPourVente(clients, vente) {
    const liste = clients || [];
    const ch = chiffresMatricule(vente && vente.matricule);
    if (ch) { const c = liste.find(x => chiffresMatricule(x.matricule) === ch); if (c) return c; }
    const nom = String((vente && vente.client) || '').trim().toLowerCase();
    if (nom) { const c = liste.find(x => String(x.name || '').trim().toLowerCase() === nom); if (c) return c; }
    return null;
  }

  // Ce que l'historique envoie à la console au premier branchement : les licences émises DANS
  // SkanFact (jamais celles qui en viennent — elle les connaît déjà). Chaque champ est nommé :
  // un test compte ce qui part, et rien d'autre ne doit s'y glisser.
  function chargeHistorique(data, company) {
    const co = company || data.company || {};
    return (data.licences || []).filter(l => l && l.key && l.origine !== 'console').map(l => {
      const inv = l.invoiceId ? (data.documents || []).find(d => d.id === l.invoiceId) : null;
      const client = l.clientId ? (data.clients || []).find(c => c.id === l.clientId) : null;
      const suivi = licenceSuivi(l, data, co);
      let facture = null;
      if (inv && inv.number) {
        facture = { numero: inv.number, montant: round3(computeTotals(inv, co).netHT), payeeLe: suivi.payee ? derniereDatePaiement(inv) : '' };
      }
      return {
        id: l.id, cle: l.key, nom: l.nom || (client ? client.name : ''), matricule: l.matricule || (client ? client.matricule : '') || '',
        email: (client && client.email) || '', offre: l.offre || 'entreprise', exp: l.exp || '', emisLe: l.emisLe || '',
        cabinet: l.cabinet || '', prix: Number(l.prix) || 0, devise: (inv && inv.currency) || co.currency || 'TND',
        remise: inv ? Number(inv.discountRate) || 0 : 0, motif: l.motif || '', remplaceePar: l.remplaceePar || '',
        revoqueeLe: l.revoqueeLe || '', revoqueeMotif: l.revoqueeMotif || '', envoyeeLe: suivi.envoyeeLe || '', facture,
        // 9.4.1 — le type et le quota d'une licence de CABINET : sans eux, la console la rangerait en
        // « Entreprise » et la renouvellerait comme telle.
        type: l.type === 'cabinet' ? 'cabinet' : 'entreprise', dossiersHors: l.type === 'cabinet' ? Math.max(0, Math.round(Number(l.dossiersHors) || 0)) : 0
      };
    });
  }
  function derniereDatePaiement(inv) { return dateDernierReglement(inv); }

  // Les factures issues d'une vente de la console, émises, dont le numéro n'a pas encore été rendu.
  function facturesAAnnoncer(data) {
    return (data.documents || []).filter(d => d && d.type === 'facture' && d.venteConsoleId && d.number && !d.factureeAnnoncee);
  }

  // Les licences qui finissent dans les trente jours et qu'on n'a pas encore renouvelées.
  function licencesExpirant(data, todayIso) {
    return licenceRows(data, todayIso).filter(l => l.etat === 'bientot' && !l.renouvelee && !l.revoqueeLe);
  }

  // ---------- ce qui demande une action ----------

  // Le panneau « À faire » de l'accueil. Renvoie des groupes ordonnés du plus urgent au moins urgent.
  // Chaque groupe : { id, level (danger|warn|info), label, detail, count, amount, route, docs }
  // `opts.copieExterne` : l'état de la copie de sauvegarde vit sur le poste, pas dans les données.
  // L'appelant le fournit ; absent, la ligne correspondante ne s'allume simplement pas.
  function todoList(data, company, todayIso, opts) {
    const t = todayIso || today();
    const out = [];
    const cur = company.currency;
    const fmt = n => money(n, cur);

    // Une facture dont la relance est REPORTÉE reste en retard (la carte « Reste à encaisser » la
    // compte) mais n'est plus à relancer aujourd'hui. Dire « 3 factures en retard » ici et « 4 en
    // retard » sur la carte, à dix centimètres, c'est deux chiffres justes qui se contredisent :
    // quand un report existe, la ligne dit « à relancer » et nomme les autres (règle 6.8.1).
    const tousRetards = overdueInvoices(data, company, t);
    // (1.293.0) Même chose pour une facture relancée cette semaine : elle attend sa réponse, la page Relances la range à
    // part, et la ligne compte ce que la page compte (`aRelancer`).
    const overdue = tousRetards.filter(aRelancer);
    const reportes = tousRetards.filter(x => x.snoozed).length;
    const enAttente = tousRetards.filter(x => x.attente).length;
    const overdueAmount = round3(overdue.reduce((s, x) => s + toBase(x.doc, x.remaining, company), 0));
    if (overdue.length) out.push({
      id: 'retards', level: 'danger', label: `${overdue.length} facture${overdue.length > 1 ? 's' : ''} en retard${reportes || enAttente ? ' à relancer' : ''}`,
      detail: `${fmt(overdueAmount)} à récupérer · plus ancienne : ${plFr(overdue[0].daysLate, 'jour')} de retard${reportes ? ` · ${reportes > 1 ? `${reportes} autres` : '1 autre'} en retard, relance reportée` : ''}${enAttente ? ` · ${enAttente > 1 ? `${enAttente} relancées` : '1 relancée'} cette semaine, en attente de réponse` : ''}`,
      count: overdue.length, amount: overdueAmount, route: '#/relances', docs: overdue.map(x => x.doc)
    });

    // Les questions du comptable restées sans réponse (9.10.0). Une question attend une pièce, une
    // explication ou une confirmation : tant qu'elle attend, le comptable ne peut pas arrêter son
    // travail, et c'est le client qui bloque sans le savoir. La ligne monte à `danger` au bout de
    // deux paquets — même seuil des deux côtés, c'est la même règle lue par les deux applications.
    const qsOuvertes = (data.questionsCabinet || []).filter(q => !(q.reponse && (String(q.reponse.texte || '').trim() || q.reponse.piece)));
    if (qsOuvertes.length) {
      const bloquees = questionsSansReponse(data.questionsCabinet || []);
      out.push({
        id: 'questions', level: bloquees.length ? 'danger' : 'warn',
        label: `${plFr(qsOuvertes.length, 'question')} de ton comptable ${qsOuvertes.length > 1 ? 'attendent' : 'attend'} ta réponse`,
        detail: bloquees.length
          ? `${plFr(bloquees.length, 't\'a été envoyée', 't\'ont été envoyées')} deux fois sans réponse : ton comptable ne peut pas arrêter ton mois tant qu'${bloquees.length > 1 ? 'elles restent' : 'elle reste'} en l'air.`
          : 'Chacune est posée en face de la pièce qu\'elle vise : ouvre-la et réponds : ton comptable lit ta réponse dès que tu l\'enregistres.',
        count: qsOuvertes.length, route: '#/compta?onglet=cabinet', docs: []
      });
    }

    // Fiche société : sans raison sociale ni matricule, une facture n'est pas conforme ; sans RIB, le client ne sait pas où payer
    const missing = companyGaps(company);
    if (missing.length) out.push({
      id: 'societe', level: 'warn', label: 'Fiche société incomplète',
      detail: `Il manque : ${missing.join(', ')}. Ces informations s'impriment sur chaque document.`,
      count: missing.length, route: '#/parametres', docs: []
    });

    // Clôture : un mois terminé depuis plus de dix jours et jamais clôturé, c'est un mois qui peut
    // encore bouger sans que personne ne le voie. Dix jours, parce qu'avant ça il manque toujours
    // une facture d'achat qui arrive par la poste.
    const toClose = closableMonths(data, t).filter(m => daysBetween(m.to, t) >= 10);
    if (toClose.length) {
      const last = toClose[toClose.length - 1];
      out.push({
        id: 'cloture', level: toClose.length > 2 ? 'warn' : 'info',
        label: toClose.length === 1 ? `${last.label} est à clôturer` : `${toClose.length} mois à clôturer`,
        detail: toClose.length === 1
          ? 'Le mois est terminé et tout devrait être saisi. Clôturer, c\'est promettre à ton comptable que ce mois ne bougera plus.'
          : `De ${toClose[0].label} à ${last.label}. Tant qu\'un mois n\'est pas clôturé, une saisie d\'aujourd\'hui peut en changer la TVA sans que personne ne le voie.`,
        count: toClose.length, route: '#/compta', docs: []
      });
    }

    const due = dueRecurrences(data, t);
    if (due.length) out.push({
      id: 'contrats', level: 'warn', label: `${due.length} facture${due.length > 1 ? 's' : ''} de contrat à générer`,
      detail: due.map(r => fillTemplate(r.subject, { mois: monthLabel(r.nextDate) })).join(' · '),
      count: due.length, route: '#/contrats', docs: []
    });

    // Plateforme (brique 90) : ce qui est livré sans être facturé, reçu sans la facture du fournisseur, commandé
    // et pas arrivé à la date souhaitée. Chaque ligne compte avec la fonction de la liste qu'elle ouvre.
    const bonsAF = bonsAFacturer(data);
    if (bonsAF.length) {
      const ht = round3(bonsAF.reduce((s, d) => s + toBase(d, computeTotals(d, company).netHT, company), 0));
      out.push({ id: 'bons-a-facturer', level: 'warn', label: `${plFr(bonsAF.length, 'bon de livraison', 'bons de livraison')} à facturer`,
        detail: `${fmt(ht)} HT livrés, pas encore facturés. « Facturer des bons… » en fait une facture par client.`,
        count: bonsAF.length, amount: ht, route: '#/autres/livraison', docs: bonsAF });
    }
    const recAF = receptionsAFacturer(data);
    if (recAF.length) {
      const noms = Array.from(new Set(recAF.map(r => ((data.suppliers || []).find(x => x.id === r.supplierId) || {}).name).filter(Boolean)));
      out.push({ id: 'receptions-a-facturer', level: 'info', label: `${plFr(recAF.length, 'réception attend', 'réceptions attendent')} la facture du fournisseur`,
        detail: `${noms.join(', ')} : la marchandise est en stock, sa facture n'est pas saisie. Saisis-la depuis la réception.`,
        count: recAF.length, route: '#/commandesf/receptions', docs: [] });
    }
    const enRetard = commandesFournisseurEnRetard(data, t);
    if (enRetard.length) {
      const plusVieille = enRetard.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
      out.push({ id: 'commandesf-retard', level: 'warn', label: `${plFr(enRetard.length, 'commande fournisseur', 'commandes fournisseurs')} en retard de livraison`,
        detail: `La plus ancienne : ${plusVieille.number} (${((data.suppliers || []).find(x => x.id === plusVieille.supplierId) || {}).name || 'fournisseur'}), attendue le ${fmtDate(plusVieille.dueDate)}. Relance le fournisseur.`,
        count: enRetard.length, route: '#/commandesf/commandes', docs: [] });
    }

    // Les lots qui périment dans les 30 jours (plateforme, brique 97) : les vendre d'abord, ou les retirer.
    const aPerimer = lotsAPerimer(data, t, 30);
    if (aPerimer.length) {
      const perimes = aPerimer.filter(x => x.perime).length, p0 = aPerimer[0];
      out.push({ id: 'lots-peremption', level: perimes ? 'warn' : 'info',
        label: perimes ? `${plFr(perimes, 'lot périmé', 'lots périmés')} encore en stock` : `${plFr(aPerimer.length, 'lot périme', 'lots périment')} dans les 30 jours`,
        detail: `Le premier : ${p0.label}, lot ${p0.lot} (${round3(p0.qty)}), ${p0.perime ? 'périmé le' : 'périme le'} ${fmtDate(p0.peremption)}. Vends-le d'abord, ou sors-le du stock (casse).`,
        count: aPerimer.length, route: `#/article/${p0.itemId}`, docs: [] });
    }

    // Devis acceptés dont le montant n'a pas été facturé EN ENTIER (même en brouillon) : le travail
    // est vendu, pas facturé. Un ACOMPTE porte `fromQuoteId` lui aussi (7.29.0) : le compter comme la
    // facture du devis faisait disparaître de « À faire » un devis dont 30 % seulement étaient
    // facturés — et les 70 % restants n'étaient réclamés nulle part (10.12.0, une menuiserie qui
    // avait facturé son acompte). Seule une facture totale ou de solde ferme la ligne ; les acomptes,
    // eux, se retranchent du montant annoncé — sans leur timbre, que le devis ne portait pas.
    const tirees = (data.documents || []).filter(d => d.type === 'facture' && d.fromQuoteId);
    const billed = new Set(tirees.filter(d => !d.deposit).map(d => d.fromQuoteId));
    const acomptesDe = id => tirees.filter(d => d.deposit && d.fromQuoteId === id && effectiveStatus(d, data, company, t) !== 'annulée');
    const accepted = (data.documents || []).filter(d => d.type === 'devis' && d.status === 'accepté' && !billed.has(d.id));
    const resteDe = q => Math.max(0, round3(toBase(q, computeTotals(q, company).totalTTC, company)
      - acomptesDe(q.id).reduce((s, a) => { const ta = computeTotals(a, company); return s + toBase(a, ta.totalTTC - (ta.stamp || 0), company); }, 0)));
    const acceptedAmount = round3(accepted.reduce((s, d) => s + resteDe(d), 0));
    const avecAcompte = accepted.filter(q => acomptesDe(q.id).length).length;
    if (accepted.length) out.push({
      id: 'devis-acceptes', level: 'warn', label: `${accepted.length} devis accepté${accepted.length > 1 ? 's' : ''} à facturer`,
      detail: avecAcompte
        ? `${fmt(acceptedAmount)} TTC vendus et pas encore facturés, acomptes déduits : pour un devis dont l'acompte est facturé, « Facturer le solde » est dans le menu de sa ligne.`
        : `${fmt(acceptedAmount)} TTC vendus et pas encore facturés : le bouton « Facturer » est sur chaque ligne.`,
      count: accepted.length, amount: acceptedAmount, route: '#/devis', docs: accepted
    });

    const expired = (data.documents || []).filter(d => d.type === 'devis' && effectiveStatus(d, data, company, t) === 'expiré');
    if (expired.length) out.push({
      id: 'devis-expires', level: 'warn', label: `${expired.length} devis expiré${expired.length > 1 ? 's' : ''}`,
      detail: 'La date de validité est passée sans réponse : relance ou classe-les en refusés.',
      count: expired.length, route: '#/devis', docs: expired
    });

    // Devis envoyés, encore valables, mais sans nouvelle depuis plus de 15 jours
    const silent = (data.documents || []).filter(d => d.type === 'devis' && effectiveStatus(d, data, company, t) === 'envoyé' && d.date && daysBetween(d.date, t) > 15);
    if (silent.length) out.push({
      id: 'devis-sans-reponse', level: 'info', label: `${silent.length} devis sans réponse depuis plus de 15 jours`,
      detail: 'Un appel ou un email relance souvent une décision qui traîne.',
      count: silent.length, route: '#/devis', docs: silent
    });

    // Seulement ce que les clients ont DÉJÀ retenu en payant (10.14.0) : une facture pas encore réglée
    // n'a rien retenu, et son attestation n'existe pas encore. Le montant est celui des encaissements.
    const rsAttendues = attestationsARecevoir(data, company);
    const rsPending = rsAttendues.map(x => x.doc);
    const rsAmount = round3(rsAttendues.reduce((s, x) => s + x.amount, 0));
    if (rsPending.length) out.push({
      id: 'attestations', level: 'warn', label: `${rsPending.length} attestation${rsPending.length > 1 ? 's' : ''} de retenue à réclamer`,
      detail: `${fmt(rsAmount)} retenus par tes clients. Sans attestation, tu ne peux pas les déduire de ton impôt.`,
      count: rsPending.length, amount: rsAmount, route: '#/compta', docs: rsPending
    });

    // Côté sortant : ce qu'on doit soi-même. Un fournisseur impayé coûte la relation, pas seulement l'argent.
    const owed = payablesList(data, company, t);
    const owedLate = owed.filter(x => x.late > 0);
    if (owedLate.length) out.push({
      id: 'fournisseurs-retard', level: 'danger',
      label: `${owedLate.length} facture${owedLate.length > 1 ? 's' : ''} fournisseur en retard`,
      detail: `${fmt(round3(owedLate.reduce((s, x) => s + x.remaining, 0)))} à régler · la plus ancienne : ${plFr(owedLate[0].late, 'jour')} de retard`,
      count: owedLate.length, amount: round3(owedLate.reduce((s, x) => s + x.remaining, 0)), route: '#/achats', docs: []
    });
    const owedSoon = owed.filter(x => !x.late && x.dueDate && daysBetween(t, x.dueDate) <= 7);
    if (owedSoon.length) out.push({
      id: 'fournisseurs-echeances', level: 'info',
      label: `${owedSoon.length} règlement${owedSoon.length > 1 ? 's' : ''} fournisseur cette semaine`,
      detail: `${fmt(round3(owedSoon.reduce((s, x) => s + x.remaining, 0)))} à prévoir sur ton compte.`,
      count: owedSoon.length, route: '#/achats', docs: []
    });
    // Stock : d'abord l'impossible (on a vendu ce qu'on n'avait pas), ensuite ce qui va manquer.
    const negStock = stockList(data).filter(x => x.negative);
    if (negStock.length) out.push({
      id: 'stock-negatif', level: 'danger',
      label: `${negStock.length} article${negStock.length > 1 ? 's' : ''} en stock négatif`,
      detail: `${negStock.map(x => x.label).slice(0, 3).join(', ')}${negStock.length > 3 ? '…' : ''} : tu as vendu plus que tu n'as acheté. Un achat manque, ou une quantité a été saisie de travers.`,
      count: negStock.length, route: '#/stock', docs: []
    });
    const lowStock = stockList(data).filter(x => x.low);
    if (lowStock.length) out.push({
      id: 'stock-bas', level: 'warn',
      label: `${lowStock.length} article${lowStock.length > 1 ? 's' : ''} à recommander`,
      detail: `${lowStock.map(x => `${x.label} (${x.qty} ${x.unit || ''})`.trim()).slice(0, 3).join(' · ')}${lowStock.length > 3 ? '…' : ''} — sous le seuil d'alerte.`,
      count: lowStock.length, route: '#/stock', docs: []
    });
    // Déclarations sociales à déposer : la CNSS ne relance pas, elle pénalise.
    const soc = socialDue(data, t);
    if (soc.length) out.push({
      id: 'declarations-sociales', level: soc.some(x => x.late) ? 'danger' : 'warn',
      label: `${soc.length} déclaration${soc.length > 1 ? 's' : ''} sociale${soc.length > 1 ? 's' : ''} à déposer`,
      // Toutes les années sont regardées depuis la 10.14.1 : une ligne d'« À faire » ne s'allonge pas
      // pour autant d'une phrase par trimestre — les trois plus anciennes, et le compte du reste.
      detail: soc.slice(0, 3).map(x => `${x.label} — ${x.late ? 'échéance dépassée le ' : 'avant le '}${fmtDate(x.dueDate)}`).join(' · ')
        + (soc.length > 3 ? ` · et ${plFr(soc.length - 3, 'autre')}` : ''),
      count: soc.length, route: '#/paie', docs: []
    });
    // Paie : les bulletins du mois écoulé qui manquent, et le doublon avec un mouvement « Salaires ».
    if ((data.employees || []).length) {
      const prev = addMonths(`${t.slice(0, 7)}-01`, -1, 1);
      const py = Number(prev.slice(0, 4)), pm = Number(prev.slice(5, 7));
      const miss = missingPayslips(data, py, pm);
      if (miss.length) out.push({
        id: 'bulletins', level: 'warn',
        label: `${miss.length} bulletin${miss.length > 1 ? 's' : ''} de paie à établir pour ${monthLabel(prev)}`,
        detail: `${miss.map(e => e.name).slice(0, 4).join(', ')}${miss.length > 4 ? '…' : ''}. Un salarié actif sans bulletin, c'est un oubli.`,
        count: miss.length, route: '#/paie', docs: []
      });
      // E-04 : un bulletin impossible enregistré avant la garde. Rouge, parce qu'il fausse une
      // déclaration qu'on s'apprête à déposer ; et il NOMME qui, et quand.
      const imp = bulletinsImpossibles(data);
      if (imp.length) {
        const qui = x => `${((data.employees || []).find(e => e.id === x.employeeId) || {}).name || 'un salarié'} (${monthLabel(`${x.year}-${String(x.month).padStart(2, '0')}-01`)})`;
        out.push({
          id: 'bulletins-impossibles', level: 'danger',
          label: `${plFr(imp.length, 'bulletin')} au net négatif, à corriger avant de déclarer`,
          detail: `${imp.slice(0, 3).map(qui).join(', ')}${imp.length > 3 ? '…' : ''}. ${imp.length > 1 ? 'Ils ont été enregistrés' : 'Il a été enregistré'} avant que SkanFact ne refuse ce cas : l'écriture de paie est inversée, et la déclaration CNSS du trimestre ${imp.length > 1 ? 'les' : 'le'} compte. Corrige les absences ou les retenues.`,
          count: imp.length, route: '#/paie', docs: []
        });
      }
      // (plateforme) 1.232.0 — ce que la paie attend de l'entreprise (docs/revue-paie.md, P6) : une correction que le cabinet
      // propose, des bulletins à approuver avant de les payer (le cabinet tient la paie), une demande de congé sans réponse.
      const co = company || data.company || {};
      const ymP = p => `${p.year}-${String(p.month).padStart(2, '0')}`;
      const modeP = p => (co.paieModeDes && ymP(p) < co.paieModeDes ? (co.paieModeAvant || '') : (co.paieMode || ''));
      const corr = (data.payslips || []).filter(p => p.correction && !p.correction.reponse && !p.paidDate);
      if (corr.length) out.push({
        id: 'paie-correction', level: 'warn', mois: ymP(corr[0]),
        label: `${corr.length > 1 ? `${corr.length} corrections de bulletin proposées` : 'Une correction de bulletin proposée'} par ton comptable`,
        detail: 'Accepte-la ou refuse-la avant de payer : le bulletin garde écrit qui l\'a proposée et qui l\'a acceptée.',
        count: corr.length, route: '#/paie', docs: []
      });
      const bap = (data.payslips || []).filter(p => !p.paidDate && !p.bonAPayerLe && modeP(p) === 'tenue' && !(p.correction && !p.correction.reponse));
      if (bap.length) out.push({
        id: 'paie-bon-a-payer', level: 'warn', mois: ymP(bap[0]),
        label: `${plFr(bap.length, 'bulletin')} à approuver avant de payer`,
        detail: 'Ton cabinet les a préparés : ton accord les rend payables.',
        count: bap.length, route: '#/paie', docs: []
      });
      const dem = (data.leaves || []).filter(l => l.statut === 'demande');
      if (dem.length) out.push({
        id: 'conges-demandes', level: 'warn',
        label: `${dem.length > 1 ? `${dem.length} demandes de congé attendent` : 'Une demande de congé attend'} ta réponse`,
        detail: dem.slice(0, 3).map(l => `${((data.employees || []).find(e => e.id === l.employeeId) || {}).name || 'un salarié'}, du ${fmtDate(l.from)} au ${fmtDate(l.to)}`).join(' · '),
        count: dem.length, route: '#/paie', docs: []
      });
      // Le bulletin réglé produit déjà sa sortie d'argent : un mouvement « Salaires » du même mois ferait double.
      const paidMonths = new Set((data.payslips || []).filter(p => p.paidDate).map(p => (p.paidDate || '').slice(0, 7)));
      const dbl = (data.movements || []).filter(m => m.kind === 'salaire' && paidMonths.has((m.date || '').slice(0, 7)));
      if (dbl.length) out.push({
        id: 'salaires-double', level: 'warn',
        label: `${dbl.length} mouvement${dbl.length > 1 ? 's' : ''} « Salaires » compté${dbl.length > 1 ? 's' : ''} deux fois`,
        detail: 'Un bulletin réglé sort déjà l\'argent tout seul. Supprime ces mouvements libres, sinon ta trésorerie est fausse du montant des salaires.',
        count: dbl.length, route: '#/tresorerie', docs: []
      });
    }
    // Garanties qui se terminent : une occasion de proposer un contrat, pas une mauvaise nouvelle.
    // (1.295.0) Une garantie déjà proposée (contrat ou devis) ne se compte plus : la page dit le même chiffre.
    const war = garantiesAProposer(data, 60, t);
    if (war.length) out.push({
      id: 'garanties', level: 'info',
      label: `${war.length} garantie${war.length > 1 ? 's' : ''} se termine${war.length > 1 ? 'nt' : ''} dans moins de deux mois`,
      detail: `${war.slice(0, 3).map(x => `${x.itemLabel} chez ${x.clientName || 'un client'} (${fmtDate(x.warrantyEndDate)})`).join(' · ')}${war.length > 3 ? '…' : ''} — le moment de proposer un contrat de maintenance.`,
      count: war.length, route: '#/garanties', docs: []
    });
    // Numéros de série et quantités qui ne disent plus la même chose
    const gaps = serialGaps(data, t);
    if (gaps.length) out.push({
      id: 'series-ecart', level: 'warn',
      label: `${gaps.length} article${gaps.length > 1 ? 's' : ''} dont les numéros de série ne collent pas au stock`,
      detail: gaps.map(g => `${g.label} : ${g.qty} en stock, ${plFr(g.serials, 'numéro')} disponible${sAccord(g.serials)}`).join(' · ') + '. Un numéro n\'a pas été saisi à l\'entrée, ou pas attribué à la sortie.',
      count: gaps.length, route: '#/stock', docs: []
    });
    // Un bien créé avant l'avoir de son fournisseur (10.14.1) : sa fiche garde le montant d'avant, le
    // bilan le montant diminué, et la dotation se calcule sur le mauvais.
    const aDiminuer = biensADiminuer(data);
    if (aDiminuer.length && !(opts && opts.reserves || []).includes('immos')) out.push({
      id: 'immobilisations-avoir', level: 'warn',
      label: `${aDiminuer.length === 1 ? 'Un bien garde' : `${aDiminuer.length} biens gardent`} son montant d'avant l'avoir du fournisseur`,
      detail: aDiminuer.map(b => `${b.label} : ${fmt(b.montant)} sur la fiche, ${fmt(b.attendu)} après l'avoir`).join(' · ') + '. Corrige la valeur sur la fiche du bien : l\'amortissement se calcule dessus.',
      count: aDiminuer.length, route: '#/immo/' + aDiminuer[0].assetId, docs: []
    });
    // Lignes d'achat marquées « immobilisation » sans fiche : sans elles, aucune dotation n'est calculée
    // et le résultat de l'année est faussement bon (3.5.0).
    const toImmo = assetsToCreate(data);
    if (toImmo.length) {
      const montantImmo = fmt(round3(toImmo.reduce((sum, x) => sum + x.amount, 0)));
      // « Tant que la fiche manque, rien n'est déduit » est vrai quand on PEUT créer la fiche. Quand
      // l'offre ferme le module, c'est faux — et c'est un reproche adressé à quelqu'un à qui on n'a
      // rien offert (7.20.0). La ligne d'achat part au cabinet dans les écritures, au compte 22, et
      // c'est LUI qui crée la fiche depuis la 9.7.0 : rien n'est perdu, et l'app doit le dire.
      const immoFerme = (opts && opts.reserves || []).includes('immos');
      out.push({
        id: 'immobilisations', level: 'info',
        label: `${toImmo.length} achat${toImmo.length > 1 ? 's' : ''} à immobiliser`,
        detail: immoFerme
          ? `${montantImmo} achetés en immobilisation. Ton comptable les voit dans les écritures du paquet et établit leur plan d'amortissement : tu n'as rien à faire.`
          : `${montantImmo} achetés en immobilisation sans plan d'amortissement. Tant que la fiche manque, rien n'est déduit.`,
        count: toImmo.length, route: '#/immos', docs: []
      });
    }
    // Attestations de retenue que TU dois remettre à tes fournisseurs prestataires
    const wOut = withholdingsToIssue(data, company);
    if (wOut.length) out.push({
      id: 'attestations-fournisseurs', level: 'warn',
      label: `${wOut.length} attestation${wOut.length > 1 ? 's' : ''} de retenue à remettre`,
      detail: `${fmt(round3(wOut.reduce((s, x) => s + x.amount, 0)))} retenus à tes fournisseurs. Sans attestation de ta part, ils ne peuvent pas la déduire.`,
      count: wOut.length, route: '#/achats', docs: []
    });
    // Les attestations d'exonération de retenue qui finissent (10.15.0, H7) : la tienne — sans elle,
    // tes clients recommencent à te retenir — et celles de tes fournisseurs — sans elles, c'est toi
    // qui dois recommencer à leur retenir. Une ligne pour chaque côté : le geste n'est pas le même.
    const exos = exonerationsAFaire(data, company, t);
    const exoCo = exos.find(x => x.qui === 'entreprise');
    if (exoCo) out.push({
      id: 'exoneration-entreprise', level: 'warn',
      label: exoCo.etat === 'expiree' ? 'Ton attestation d\'exonération de retenue a expiré' : 'Ton attestation d\'exonération de retenue finit bientôt',
      detail: exoCo.etat === 'expiree'
        ? `Elle a pris fin le ${fmtDate(exoCo.au)} : tes factures ne portent plus la mention, et tes clients te retiennent de nouveau. Demande la suivante, puis saisis-la.`
        : `Elle finit le ${fmtDate(exoCo.au)}. Demande la suivante avant : sans elle, tes clients recommencent à te retenir.`,
      count: 1, route: '#/parametres', docs: []
    });
    const exoSup = exos.filter(x => x.qui === 'fournisseur');
    if (exoSup.length) out.push({
      id: 'exonerations-fournisseurs', level: 'info',
      label: `${exoSup.length} attestation${exoSup.length > 1 ? 's' : ''} d'exonération de fournisseur à renouveler`,
      detail: exoSup.map(x => `${x.nom || 'Fournisseur'} (${x.etat === 'expiree' ? 'expirée le' : 'finit le'} ${fmtDate(x.au)})`).join(', ') + ' : sans la suivante, la retenue de sa fiche s\'applique de nouveau à ses règlements.',
      count: exoSup.length, route: '#/fournisseurs', docs: []
    });

    const soon = (data.documents || []).filter(d => d.type === 'facture' && ['envoyée', 'partielle'].includes(effectiveStatus(d, data, company, t))
      && d.dueDate && d.dueDate >= t && daysBetween(t, d.dueDate) <= 7);
    if (soon.length) out.push({
      id: 'echeances', level: 'info', label: `${soon.length} facture${soon.length > 1 ? 's' : ''} à échéance cette semaine`,
      detail: 'Un message avant l\'échéance évite souvent la relance après.',
      count: soon.length, route: '#/relances', docs: soon
    });

    // Un trou de trésorerie prévu passe avant tout le reste : une entreprise rentable peut en mourir.
    if ((data.accounts || []).length) {
      const f = cashForecast(data, company, 60, t);
      // (1.266.0) Sous le seuil que l'entreprise s'est fixé (zéro par défaut) ; le chiffre dit est le point le plus bas.
      if (f.shortfall) out.unshift({
        id: 'tresorerie', level: 'danger',
        label: f.seuil ? `Trésorerie sous ton seuil le ${fmtDate(f.shortfall.date)}` : `Trou de trésorerie prévu le ${fmtDate(f.shortfall.date)}`,
        detail: `Après « ${f.shortfall.label} », ton solde descendrait jusqu'à ${fmt(f.shortfall.lowest.balance)} le ${fmtDate(f.shortfall.lowest.date)}. Relance tes impayés ou décale un règlement.`,
        count: 1, amount: f.shortfall.lowest.balance, route: '#/tresorerie', docs: []
      });
    }

    // Échéances fiscales des deux prochaines semaines. C'est un pense-bête réglé par l'utilisateur :
    // les dates et la périodicité relèvent du « À VÉRIFIER avec ton comptable ».
    // Une échéance du calendrier qui rappelle une déclaration déjà annoncée plus haut (« déclarations
    // sociales à déposer ») ne se compte pas deux fois (10.12.0).
    const annoncees = new Set(soc.map(x => x.id));
    const fisc = upcomingFiscal(data, t, 14).filter(x => !(x.socialId && annoncees.has(x.socialId)));
    if (fisc.length) out.push({
      id: 'fiscal', level: fisc[0].days <= 5 ? 'warn' : 'info',
      label: `${fisc.length} échéance${fisc.length > 1 ? 's' : ''} fiscale${fisc.length > 1 ? 's' : ''} sous 15 jours`,
      detail: fisc.map(x => `${x.label} le ${fmtDate(x.date)}`).join(' · '),
      count: fisc.length, route: '#/compta', docs: []
    });

    // Deux lignes, pas une. La ligne unique comptait TOUS les brouillons — devis compris — et son
    // seul bouton ouvrait la liste des FACTURES filtrée sur « brouillon », où un devis ne peut pas
    // figurer : le rappel existait, et menait à une liste où la pièce annoncée était invisible.
    // La règle du projet : un compteur et la liste qu'il annonce se calculent avec la même fonction.
    const vieux = d => d.status === 'brouillon' && d.date && daysBetween(d.date, t) > 7;
    const draftInv = (data.documents || []).filter(d => vieux(d) && d.type !== 'devis');
    if (draftInv.length) out.push({
      id: 'brouillons', level: 'info', label: `${draftInv.length} brouillon${draftInv.length > 1 ? 's' : ''} de facture de plus de 7 jours`,
      detail: 'Un brouillon oublié, c\'est un travail non facturé.',
      count: draftInv.length, route: '#/factures', docs: draftInv
    });
    // Un devis en brouillon est plus insidieux : il porte déjà son numéro (attribué au premier
    // enregistrement), son PDF est indiscernable d'un devis envoyé, et tant qu'il reste brouillon
    // SkanFact ne le relance pas, ne le compte pas dans le taux de transformation, et ne le déclare
    // jamais expiré. Un devis parti par WhatsApp ou remis en main propre reste donc invisible.
    const draftQuotes = (data.documents || []).filter(d => vieux(d) && d.type === 'devis');
    if (draftQuotes.length) out.push({
      id: 'devis-brouillons', level: 'info', label: `${draftQuotes.length} devis en brouillon de plus de 7 jours`,
      detail: 'Tant qu\'un devis est en brouillon, il n\'est ni relancé, ni compté, ni jamais déclaré expiré. Si tu l\'as envoyé autrement (WhatsApp, main propre), passe-le à « envoyé ».',
      count: draftQuotes.length, route: '#/devis', docs: draftQuotes
    });

    // La copie de sauvegarde, quand c'est la seule étape de démarrage qui manque. Elle quitte alors
    // le panneau « Tes premiers pas » (qui disparaît) pour devenir une ligne ordinaire : c'est
    // l'étape que tout le monde saute, et la seule dont l'absence coûte tout.
    const pas = firstSteps(data, company, opts || {});
    if (pas.sauvegardeSeule) out.push({
      id: 'sauvegarde', level: 'warn', label: 'Tes données ne sont copiées nulle part',
      detail: 'Un disque qui lâche, un ordinateur volé, et tout est perdu. Une copie automatique vers iCloud ou OneDrive, un disque ou une clé USB prend deux minutes à mettre en place.',
      count: 1, route: '#/parametres'
    });

    // Les pièces en devise étrangère sans taux de change. Elles ne se signalaient nulle part et
    // faisaient compter 1 euro = 1 dinar dans le journal des ventes, la TVA à déclarer, le chiffre
    // d'affaires et le paquet envoyé au comptable. Depuis la 7.0.1 la saisie les refuse ; celles qui
    // existent déjà doivent se rattraper, sinon la déclaration part fausse.
    const sansTaux = (data.documents || []).filter(d => missingRate(d, company));
    if (sansTaux.length) out.push({
      id: 'taux-change', level: 'danger',
      label: `${sansTaux.length} pièce${sansTaux.length > 1 ? 's' : ''} en devise sans taux de change`,
      detail: 'Tant que le taux manque, ces montants comptent comme des dinars : ton chiffre d\'affaires et ta TVA sont faux.',
      count: sansTaux.length, route: '#/factures', docs: sansTaux
    });

    // Le JUMEAU côté achats (10.1.0). Un achat n'avait aucune devise avant cette version : ceux qui
    // en reçoivent une sans taux tombent dans le même trou, en pire — la TVA DÉDUCTIBLE part alors
    // fausse dans une déclaration qu'on ne refait pas. Une ligne à part, parce que le geste qui la
    // règle n'est pas au même endroit (règle 7.15.0 : ce qu'un écran nomme, il doit l'ouvrir).
    const achatsSansTaux = (data.purchases || []).filter(p => missingRate(p, company));
    if (achatsSansTaux.length) out.push({
      id: 'taux-achat', level: 'danger',
      label: `${plFr(achatsSansTaux.length, 'achat')} en devise sans taux de change`,
      detail: 'Tant que le taux manque, ces montants comptent comme des dinars : ta TVA déductible et tes charges sont fausses.',
      count: achatsSansTaux.length, route: '#/achats', purchases: achatsSansTaux
    });

    // Les avoirs et les acomptes qui n'ont pas trouvé leur facture (10.2.0). Un avoir non imputé est
    // de l'argent qu'on a déjà, un acompte non imputé est de l'argent déjà sorti : les deux sont
    // justes tant que la facture n'est pas arrivée, et faux le jour où elle est payée en entier.
    // Rien à l'écran ne le disait — d'où la ligne, avec le geste qui la règle.
    const nonImputes = (data.purchases || []).filter(p => aRattacherAchat(p, company, data));
    if (nonImputes.length) out.push({
      id: 'achat-impute', level: 'warn',
      label: `${plFr(nonImputes.length, 'pièce')} fournisseur à rattacher à sa facture`,
      detail: 'Un avoir ou un acompte qui ne pointe aucune facture ne vient en déduction de rien : tu risques de payer deux fois.',
      count: nonImputes.length, route: '#/achats', purchases: nonImputes
    });

    // Les licences que l'ÉDITEUR a émises et qui finissent dans les trente jours — sur son poste
    // seulement (`opts.editeur` : la clé privée existe sur cet ordinateur). Chez un client, cette
    // liste est vide et la ligne n'existe pas : elle parlerait de licences qu'il n'a pas émises.
    const editeurIci = (opts || {}).editeur;
    // Ce qui suit l'émission d'une licence, dans l'ordre où ça coûte cher (8.2.0). Une clé signée
    // est un produit livré : tant qu'elle n'est pas partie, un client paie et attend ; tant que la
    // facture est un brouillon, la vente n'existe ni pour la TVA ni pour le journal ; tant qu'elle
    // n'est pas réglée, c'est un client qui a le produit et pas l'éditeur l'argent. Aucune de ces
    // trois lignes ne se voyait nulle part.
    const licSuite = editeurIci ? licencesAFaire(data, company, t) : { jamaisEnvoyees: [], nonFacturees: [], impayees: [], expirant: [] };
    if (licSuite.jamaisEnvoyees.length) out.push({
      id: 'licences-a-envoyer', level: 'bad',
      label: `${plFr(licSuite.jamaisEnvoyees.length, 'clé de licence', 'clés de licence')} jamais ${licSuite.jamaisEnvoyees.length > 1 ? 'envoyées' : 'envoyée'}`,
      detail: 'La clé est signée mais n\'a jamais quitté cet ordinateur : le client l\'attend, et il a peut-être déjà payé. « Envoyer la clé par email » depuis la page Licences.',
      count: licSuite.jamaisEnvoyees.length, route: '#/licences', docs: []
    });
    if (licSuite.nonFacturees.length) out.push({
      id: 'licences-sans-facture', level: 'bad',
      label: `${plFr(licSuite.nonFacturees.length, 'licence')} dont la facture est restée en brouillon`,
      detail: 'Un brouillon n\'a pas de numéro : cette vente n\'entre ni dans ton journal, ni dans ta TVA, ni dans le dossier du comptable. Ouvre la facture et émets-la.',
      count: licSuite.nonFacturees.length, route: '#/licences', docs: []
    });
    if (licSuite.impayees.length) out.push({
      id: 'licences-impayees', level: 'warn',
      label: `${plFr(licSuite.impayees.length, 'licence')} ${licSuite.impayees.length > 1 ? 'livrées' : 'livrée'} et pas encore ${licSuite.impayees.length > 1 ? 'payées' : 'payée'}`,
      detail: 'Le client a sa clé, elle fonctionne, et la facture n\'est pas réglée. C\'est le cas qui coûte : une licence hors ligne ne se reprend pas.',
      count: licSuite.impayees.length, route: '#/licences', docs: []
    });
    // L'export de la base de la console (10.4.0). C'est la SEULE chose dont la disparition ne se
    // rattrape pas : la base D1 est le seul endroit où vit « qui a acheté quelle clé », et sans
    // elle aucune licence vendue ne peut plus être renvoyée, renouvelée ni révoquée. Décidé avant
    // la première vente (QUESTIONS.md, 4e relecture) ; la ligne ne vit que sur le poste de
    // l'éditeur, comme les quatre du dessus.
    if (editeurIci) {
      const ex = exportConsoleAFaire(data, t);
      if (ex.reclame) out.push({
        id: 'console-export', level: ex.du ? 'warn' : 'danger',
        label: ex.du ? `La base de la console n'a pas été exportée depuis ${plFr(ex.jours, 'jour')}` : 'La base de la console n\'a jamais été exportée',
        detail: 'Un export la range en un fichier dans ~/.skanfact/. Sans lui, une base perdue emporte toutes les ventes : plus aucune clé vendue ne peut être renvoyée ni révoquée. Paramètres → L\'application → Éditeur.',
        count: 1, route: '#/licences'
      });
    }

    const licExp = licSuite.expirant;
    if (licExp.length) out.push({
      id: 'licences-expirent', level: 'warn',
      label: `${plFr(licExp.length, 'licence')} ${licExp.length > 1 ? 'expirent' : 'expire'} dans les ${LICENCE_PREAVIS} jours`,
      detail: 'Renouveler, c\'est une facture de plus — et un client qui n\'est pas interrompu. Chaque ligne se renouvelle en un clic depuis la page Licences.',
      count: licExp.length, route: '#/licences', docs: []
    });

    // Le commentaire en tête de cette fonction promet « du plus urgent au moins urgent » depuis la
    // 1.10.0, et l'ordre réel était celui du code — c'est-à-dire l'ordre dans lequel les modules ont
    // été écrits. Sur le jeu d'exemple, « 3 factures en retard » (rouge) se retrouvait au-dessus,
    // mais « 2 déclarations sociales en retard » (rouge aussi) arrivait NEUVIÈME, sous cinq lignes
    // orange et une bleue. Un tri stable : l'urgence décide, et à urgence égale l'ordre du code
    // (qui est thématique, donc lisible) est conservé.
    const rang = { danger: 0, warn: 1, info: 2 };
    return out
      .map((x, i) => [x, i])
      .sort((a, b) => (rang[a[0].level] - rang[b[0].level]) || (a[1] - b[1]))
      .map(p => p[0]);
  }

  // Ce qui manque à la fiche société pour que les documents soient complets.
  // (plateforme) La forme d'un matricule fiscal tunisien, telle que le serveur la porte à l'entreprise (lot facture,
  // 05/10/2026 ; serveur/v10/identite.ts) : sept chiffres, la lettre-clé (jamais I, O ni U : la règle du fichier El
  // Fatoora, teif.js), le code TVA, la catégorie et l'établissement ; les séparateurs n'y comptent pas (1234567A/A/M/000
  // comme 1234567 a a m 000). `matriculeLisible` l'écrit sous sa forme lisible ; ce qui n'en est pas un reste tel quel.
  const MF_FORME = /^[0-9]{7}[A-HJ-NP-TV-Z][A-Z]{2}[0-9]{3}$/;
  const mfCompact = (v) => String(v == null ? '' : v).toUpperCase().replace(/[\s/.\-_]/g, '');
  function matriculeBienForme(v) { return MF_FORME.test(mfCompact(v)); }
  function matriculeLisible(v) { const c = mfCompact(v); return MF_FORME.test(c) ? `${c.slice(0, 8)}/${c[8]}/${c[9]}/${c.slice(10)}` : String(v == null ? '' : v).trim(); }
  function companyGaps(company) {
    const c = company || {};
    const out = [];
    if (!(c.name || '').trim()) out.push('la raison sociale');
    if (!(c.matricule || '').trim()) out.push('le matricule fiscal');
    else if (!matriculeBienForme(c.matricule)) out.push('un matricule fiscal valide (sept chiffres, une lettre autre que I, O ou U, puis code TVA, catégorie et établissement : 1234567A/A/M/000)');
    // Le RIB ne manque que si on attend un virement (7.22.0). Voir `ribAttendu` : un commerce, un
    // restaurant ou un salon encaissent sur place.
    if (ribAttendu(c) && !(c.rib || '').trim()) out.push('le RIB');
    // Un RIB PRÉSENT et faux manque autant qu'un RIB absent (rapport QA, 10.12.0) : juger sur la
    // seule présence faisait écrire « tes documents sont en règle » sur un RIB de dix chiffres —
    // la faute du matricule inventé de la 7.6.0, un champ plus loin.
    else if (ribAttendu(c) && !verifRib(c.rib).ok) out.push(`un RIB valide (${verifRib(c.rib).court})`);
    return out;
  }

  // Un RIB tunisien : 20 chiffres (banque 2, agence 3, compte 13, clé 2), et la clé fait des vingt
  // chiffres, pris comme un nombre, un multiple de 97 — c'est ce qui donne « TN59 » à TOUS les IBAN
  // tunisiens (règle vérifiée sur un RIB publié, 07040005810111129653). Un IBAN, tunisien ou non, se
  // vérifie par la règle ISO 13616 : reste 1 modulo 97. Rend une raison COURTE (pour une étiquette)
  // et une phrase. On AVERTIT, on ne refuse jamais : un compte à l'étranger peut avoir une forme
  // qu'on ne connaît pas, et « l'assistant prévient lui-même qu'une erreur ici, c'est un paiement qui
  // n'arrive jamais » — encore fallait-il le vérifier quelque part.
  function verifRib(valeur) {
    const v = String(valeur || '').replace(/[\s.\-]/g, '').toUpperCase();
    if (!v) return { ok: true, vide: true };
    const reste97 = chiffres => { let r = 0; for (const ch of chiffres) r = (r * 10 + Number(ch)) % 97; return r; };
    if (/^\d+$/.test(v)) {
      if (v.length !== 20) return { ok: false, court: `${v.length} chiffres sur 20`, raison: `Un RIB tunisien compte 20 chiffres ; celui-ci en a ${v.length}.` };
      if (reste97(v) !== 0) return { ok: false, court: 'clé incorrecte', raison: 'Les deux derniers chiffres du RIB (sa clé) ne correspondent pas aux dix-huit premiers : une faute de frappe, probablement.' };
      return { ok: true };
    }
    if (/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(v)) {
      if (v.startsWith('TN') && v.length !== 24) return { ok: false, court: `${v.length} caractères sur 24`, raison: `Un IBAN tunisien compte 24 caractères (TN59 puis les 20 chiffres du RIB) ; celui-ci en a ${v.length}.` };
      const deplace = (v.slice(4) + v.slice(0, 4)).replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));
      if (reste97(deplace) !== 1) return { ok: false, court: 'IBAN incorrect', raison: 'La clé de cet IBAN ne correspond pas à ses chiffres : une faute de frappe, probablement.' };
      return { ok: true, iban: true };
    }
    return { ok: false, court: 'ni RIB ni IBAN', raison: 'Un RIB tunisien s\'écrit en 20 chiffres, un IBAN commence par le code de son pays (TN59…).' };
  }

  // ---------- les premiers pas (7.0.0) ----------
  //
  // Ce que quelqu'un qui vient d'installer SkanFact doit faire, dans l'ordre, pour que l'application
  // lui serve à quelque chose. Sept étapes, et un principe : **l'état de chacune est DÉDUIT des
  // données**, jamais coché à la main. Une case qu'on coche soi-même ment le jour où on l'a cochée
  // par erreur, ou reste vide le jour où on a fait le geste par un autre chemin.
  //
  // Pourquoi ça n'existait pas : jusqu'ici, le premier jour, l'accueil montrait quatre compteurs à
  // zéro, un graphique de douze mois vides, un « Top clients » vide — et, huit cents pixels plus bas,
  // deux boutons. La seule autre orientation était un toast de deux secondes et demie et un article
  // d'aide que rien ne proposait. La première phrase que l'application adressait à son utilisateur
  // était « Fiche société incomplète », c'est-à-dire un reproche, juste après un assistant qu'il
  // venait de mener jusqu'au bout.
  //
  // `opts.copieExterne` : la copie de sauvegarde vers un dossier externe ne vit pas dans les données
  // (elle est dans app-config.json, propre au poste), donc l'appelant la fournit. Elle est ici parce
  // que c'est l'étape que tout le monde saute et la seule dont l'absence coûte tout.
  // 10.12.0 — une prestation ne compte que si l'utilisateur l'a DÉCIDÉE : créée par lui, ou
  // enregistrée par lui (`catalogForm` retire alors `fromSetup`). La règle d'avant — « un prix
  // non nul suffit » — supposait que l'assistant pose des prix à 0 ; or les quinze métiers
  // proposent tous des prix d'exemple (« Main-d'œuvre » à 20 DT pour l'artisanat) : l'étape se
  // cochait donc toute seule, pour TOUT le monde, à la seconde où l'assistant se refermait. C'est
  // le défaut que la 7.18.0 croyait avoir corrigé — le test prenait « un prix posé » pour « un prix
  // ajusté », deux choses que les données ne distinguaient pas.
  function catalogueStep(d) {
    const cat = d.catalog || [];
    const exemples = cat.filter(c => c.fromSetup);
    const propre = cat.some(c => !c.fromSetup);
    if (cat.length && !propre) {
      const sansPrix = exemples.filter(c => !(Number(c.unitPrice) > 0)).length;
      return { id: 'catalogue', titre: 'Ajuster les prix de ton catalogue', fait: false,
        quoi: `L'assistant t'a proposé ${cat.length} prestation${cat.length > 1 ? 's' : ''}`
          + (sansPrix ? `, dont ${sansPrix} sans prix` : '')
          + ` : ce sont des exemples, pas tes tarifs. Ouvre-en une, mets ton prix et enregistre : elle devient la tienne.`,
        action: 'catalogue' };
    }
    return { id: 'catalogue', titre: 'Remplir ton catalogue', fait: propre,
      quoi: 'Ce que tu vends, avec son prix et sa TVA. Une ligne de devis se choisit alors dans une liste au lieu d\'être retapée.',
      action: 'catalogue' };
  }

  // ---------- « Ta facture à ton image » (10.14.0) ----------
  //
  // Le logo, le cachet et les deux couleurs se réglaient dans les Paramètres, et la page disait
  // « pour les voir, ouvre un document » : on choisissait une couleur à l'aveugle, puis on allait
  // chercher un devis pour voir ce qu'elle donnait. Ce qui suit est pur : la couleur se JUGE sur la
  // page blanche où elle s'imprime, et l'étape des premiers pas se lit dans la fiche société.
  //
  // Le contraste d'une couleur sur le blanc du papier (rapport WCAG, de 1 à 21). La couleur PRINCIPALE
  // est celle de TOUT le texte du document ; l'accent colore le numéro, les titres de rubrique et
  // « Net à payer ». Un jaune vif y serait illisible — sur la pièce qu'on envoie à son client.
  function contrasteSurBlanc(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex == null ? '' : hex).trim());
    if (!m) return null;
    const v = parseInt(m[1], 16);
    const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
    return Math.round((1.05 / (L + 0.05)) * 100) / 100;
  }
  // Les seuils : 4,5 pour un texte courant, 3 pour un texte en gras ou en capitales (WCAG AA) — c'est
  // exactement ce que l'accent colore. On PRÉVIENT, on n'interdit pas : c'est son papier.
  const LISIBLE = { primaryColor: 4.5, accentColor: 3 };
  function lisibiliteMarque(co) {
    const c = co || {};
    const out = [];
    const p = contrasteSurBlanc(c.primaryColor || DEFAULT_COMPANY.primaryColor);
    // `court` se lit dans la ligne du titre de la couleur (il ne pousse rien) ; `texte` l'explique.
    const court = 'Trop claire pour être lue';
    if (p != null && p < LISIBLE.primaryColor) out.push({ champ: 'primaryColor', rapport: p, court, texte: 'Ta couleur principale est très claire : c\'est celle de tout le texte de tes documents, et sur une page blanche il se lirait mal.' });
    const a = contrasteSurBlanc(c.accentColor || DEFAULT_COMPANY.accentColor);
    if (a != null && a < LISIBLE.accentColor) out.push({ champ: 'accentColor', rapport: a, court, texte: 'Ta couleur d\'accent est très claire : le numéro de la pièce, les titres de rubrique et « Net à payer » se liraient mal sur une page blanche.' });
    return out;
  }
  // Un nuancier PROPOSÉ, jamais imposé (le sélecteur de couleur reste là pour tout le reste) : chaque
  // teinte se lit sur le blanc — un test le vérifie, sinon la proposition ferait le défaut qu'elle évite.
  const ACCENTS_PROPOSES = [
    { nom: 'Vert d\'eau', hex: '#0f9d8f' }, { nom: 'Bleu', hex: '#2563eb' }, { nom: 'Indigo', hex: '#4f46e5' },
    { nom: 'Vert', hex: '#15803d' }, { nom: 'Ambre', hex: '#b45309' }, { nom: 'Brique', hex: '#b91c1c' },
    { nom: 'Prune', hex: '#86198f' }, { nom: 'Ardoise', hex: '#334155' }
  ];
  // Une image de marque POSÉE : un logo, un cachet, ou une couleur qui n'est plus celle d'origine.
  // Se lit dans la fiche — une étape qu'on cocherait soi-même mentirait (7.0.0).
  function marquePersonnalisee(co) {
    const c = co || {};
    const autre = (v, def) => !!String(v || '').trim() && String(v).trim().toLowerCase() !== def.toLowerCase();
    return !!(String(c.logo || '').trim() || String(c.stampImage || '').trim()
      || autre(c.accentColor, DEFAULT_COMPANY.accentColor) || autre(c.primaryColor, DEFAULT_COMPANY.primaryColor));
  }

  function firstSteps(data, company, opts) {
    const d = data || {};
    const o = opts || {};
    const docs = d.documents || [];
    const devis = docs.filter(x => x.type === 'devis');
    const gaps = companyGaps(company);
    const facturesEmises = docs.filter(x => x.type === 'facture' && x.status !== 'brouillon');
    const unPaiement = docs.some(x => (x.payments || []).length);

    const cab = (company && company.cabinet) || {};
    const comptableRelie = !!(cab.publicKey || String((company && company.accountantEmail) || '').trim());
    const etapes = [
      // La découverte (10.14.0). Faite, elle compte : la liste démarre à « 1 sur n », et une liste
      // déjà commencée se termine bien plus souvent qu'une liste à zéro. Pas faite, elle reste
      // proposée sans jamais passer devant une étape du métier (`facultatif`) : elle n'est pas un
      // devoir, et quelqu'un qui connaît déjà la facturation ne doit pas la voir en tête de liste.
      { id: 'decouverte', titre: 'Découvrir SkanFact avec l\'exemple', fait: !!o.decouverte, facultatif: true,
        quoi: o.decouverte
          ? 'Tu as fait le tour, sur une entreprise d\'exemple de cinq ans : tu sais où est chaque chose.'
          : 'Le grand tour sur une entreprise d\'exemple de cinq ans : chaque page remplie, sans rien risquer. Tes données sont mises de côté pendant ce temps.',
        action: 'decouverte' },
      { id: 'societe', titre: 'Compléter ta fiche société', fait: !gaps.length,
        quoi: gaps.length
          ? `Il manque ${liste(gaps)}. Ces informations s'impriment en haut de chaque document, et une facture sans matricule fiscal n'est pas conforme.`
          : 'Raison sociale, matricule fiscal et RIB sont renseignés : tes documents sont en règle.',
        action: 'societe' },
      // Ta facture à ton image (10.14.0) : juste après la fiche société, parce que c'est la même
      // question — ce qui s'imprime en haut de chaque pièce. Facultative : une facture sans logo est
      // une facture en règle, et l'étape ne passe jamais devant une étape du métier.
      { id: 'marque', titre: 'Ta facture à ton image', fait: marquePersonnalisee(company), facultatif: true,
        quoi: marquePersonnalisee(company)
          ? 'Ton logo et tes couleurs habillent chaque devis et chaque facture.'
          : 'Ton logo, ton cachet et ta couleur sur chaque devis et chaque facture — tu vois le résultat sur une vraie facture avant d\'enregistrer.',
        action: 'marque' },
      { id: 'client', titre: 'Enregistrer ton premier client', fait: (d.clients || []).length > 0,
        quoi: 'Son adresse et son matricule se reporteront tout seuls sur chaque devis et chaque facture.',
        action: 'client' },
      // Une étape ne peut pas se cocher parce que l'ASSISTANT l'a faite. Il propose les prestations
      // du métier avec des prix à 0 ; tant que le catalogue n'est que celui-là et qu'il reste des
      // zéros, il n'y a pas de catalogue — il y a des exemples. L'étape change alors de titre.
      catalogueStep(d),
      { id: 'devis', titre: 'Faire ton premier devis', fait: devis.length > 0,
        quoi: 'Un devis annonce un prix avant de travailler. C\'est la pièce par laquelle presque tout commence.',
        action: 'devis' },
      // La copie de sécurité vient JUSTE APRÈS le premier devis (10.14.0). Elle était le dernier écran
      // de l'assistant, avant qu'il existe quoi que ce soit à copier : une question abstraite, qu'on
      // passait. Après le premier devis, elle protège quelque chose de réel — c'est le moment où l'on
      // accepte de prendre deux minutes pour elle.
      // Un dossier PARTAGÉ vit déjà hors de cet ordinateur : l'étape est faite, et elle le DIT — sans
      // quoi elle menait à un panneau où le bouton « Choisir un dossier » est caché exprès.
      { id: 'sauvegarde', titre: 'Mettre tes données à l\'abri', fait: !!o.copieExterne || !!o.partage,
        quoi: o.partage && !o.copieExterne
          ? 'Ce dossier est partagé : il vit déjà hors de cet ordinateur, et c\'est cette copie-là que les deux postes ouvrent.'
          : 'Une copie automatique vers iCloud ou OneDrive, un disque ou une clé USB. C\'est l\'étape que tout le monde saute, et la seule dont l\'absence coûte tout.',
        action: 'sauvegarde' },
      { id: 'envoi', titre: 'L\'envoyer à ton client', fait: devis.some(x => x.status && x.status !== 'brouillon'),
        quoi: 'Ouvre le devis, puis « Envoyer » : le PDF part en pièce jointe. Tant qu\'un devis reste en brouillon, SkanFact ne le compte nulle part.',
        action: devis.length ? 'envoiDevis' : null },
      { id: 'facture', titre: 'Transformer un devis accepté en facture', fait: facturesEmises.length > 0,
        quoi: 'En un clic, sans rien ressaisir. C\'est à ce moment-là que le numéro est attribué et que la pièce se verrouille.',
        action: 'factures' },
      // Le comptable (10.14.0) : son adresse suffit pour lui envoyer le paquet du mois ; son fichier
      // d'appairage, s'il a SkanFact Cabinet, chiffre ce paquet pour lui seul. Facultatif : certains
      // n'en ont pas encore, et ce n'est pas à nous de décider qu'ils en ont besoin.
      { id: 'comptable', titre: 'Relier ton comptable', fait: comptableRelie, facultatif: true,
        quoi: comptableRelie
          ? (cab.publicKey ? `Tes paquets partent chiffrés pour ${cab.name || 'ton cabinet'}.` : 'Son adresse est enregistrée : « Envoyer au comptable » s\'en sert.')
          : 'Son adresse, et son fichier d\'appairage s\'il utilise SkanFact Cabinet : chaque mois, le paquet de tes pièces part en deux clics, sans rien ressaisir de son côté.',
        action: 'comptable' }
    ];
    if (unPaiement) {
      etapes.push({ id: 'encaissement', titre: 'Encaisser', fait: true,
        quoi: 'Un paiement enregistré fait basculer la facture toute seule : tu ne saisis jamais « payée » à la main.', action: 'factures' });
    }
    const faits = etapes.filter(x => x.fait).length;
    // Le panneau ne vaut que pendant le DÉMARRAGE. Une fois qu'une facture est partie, quelqu'un qui
    // a deux ans d'activité n'a plus rien à faire d'un écran qui lui propose « crée ton premier
    // client » — et le panneau reprendrait tout l'écran, exactement le défaut qu'il corrige.
    // La copie de sauvegarde, elle, reste importante : quand c'est la seule étape qui manque, elle
    // devient une ligne de « À faire », pas un panneau.
    // Les étapes FACULTATIVES (la découverte, le comptable) ne retiennent pas le panneau : un panneau
    // qui ne disparaîtrait jamais parce qu'on n'a pas de comptable serait le panneau qu'on apprend à
    // ne plus lire.
    const metier = etapes.filter(x => x.id !== 'sauvegarde' && !x.facultatif);
    const demarrage = metier.some(x => !x.fait);
    // L'étape SUIVANTE, calculée ici une fois pour l'accueil, la jauge de fin de visite et « Me
    // guider » : la première qui n'est ni faite ni facultative. Trois endroits qui la recalculaient
    // chacun avec `find(e => !e.fait)` auraient proposé « découvrir l'exemple » à quelqu'un qui vient
    // de refuser la découverte, en tête et en vert, devant sa fiche société.
    const suivante = etapes.find(x => !x.fait && !x.facultatif) || null;
    return { etapes, faits, total: etapes.length, fini: faits === etapes.length, demarrage, suivante,
      sauvegardeSeule: !demarrage && !etapes.find(x => x.id === 'sauvegarde').fait };
  }

  // Les RÉUSSITES (10.14.0) : les premières fois qui comptent dans la vie d'une entreprise sur
  // SkanFact — le premier devis envoyé, la première facture émise, le premier paiement, le premier
  // paquet parti chez le comptable. Toutes DÉDUITES des données : une réussite qu'on cocherait soi-même
  // mentirait le jour où on l'a cochée par erreur (7.0.0). L'hôte ne les montre jamais sur l'exemple :
  // celles d'une entreprise inventée ne sont pas les tiennes.
  function reussites(data, company, opts) {
    const d = data || {};
    const o = opts || {};
    const docs = d.documents || [];
    const emise = x => x.number && x.status !== 'brouillon';
    const liste = [
      { id: 'fiche', titre: 'Fiche société complète', quoi: 'Tes pièces portent tout ce qu\'une pièce officielle doit porter.', fait: !companyGaps(company).length },
      { id: 'client', titre: 'Premier client', quoi: 'Ses coordonnées se reportent toutes seules sur chaque pièce.', fait: (d.clients || []).length > 0 },
      { id: 'devis', titre: 'Premier devis envoyé', quoi: 'Un prix annoncé avant de travailler : c\'est ainsi que presque tout commence.', fait: docs.some(x => x.type === 'devis' && x.status && x.status !== 'brouillon') },
      { id: 'facture', titre: 'Première facture émise', quoi: 'Numérotée, verrouillée, comptée dans ton chiffre d\'affaires et ta TVA.', fait: docs.some(x => x.type === 'facture' && emise(x)) },
      { id: 'paiement', titre: 'Premier paiement encaissé', quoi: 'La facture s\'est soldée toute seule, et l\'argent est arrivé dans ta trésorerie.', fait: docs.some(x => (x.payments || []).length > 0) },
      { id: 'achat', titre: 'Premier achat saisi', quoi: 'La TVA que tu récupères commence à compter.', fait: (d.purchases || []).length > 0 },
      { id: 'abri', titre: 'Données à l\'abri', fait: !!o.copieExterne || !!o.partage,
        quoi: o.partage && !o.copieExterne ? 'Ton dossier partagé vit hors de cet ordinateur.' : 'Une copie automatique vit hors de cet ordinateur.' },
      { id: 'comptable', titre: 'Premier paquet au comptable', quoi: 'Ton comptable a reçu ton mois, déjà écrit : zéro ressaisie.', fait: (d.packs || []).length > 0 },
      { id: 'cloture', titre: 'Premier mois clôturé', quoi: 'Un mois déclaré, et qui ne bougera plus.', fait: !!d.closedUntil }
    ];
    return { liste, faites: liste.filter(x => x.fait).length, total: liste.length };
  }

  // « a », « a et b », « a, b et c » — parce qu'« il manque le matricule fiscal, le RIB » se voit.
  function liste(mots) {
    const m = (mots || []).filter(Boolean);
    if (m.length <= 1) return m[0] || '';
    return m.slice(0, -1).join(', ') + ' et ' + m[m.length - 1];
  }

  // Historique d'un document, reconstitué à partir de ce qui est déjà enregistré.
  function documentHistory(doc, data, company) {
    const ev = [];
    const dateOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    // `ts` : l'instant du geste quand la pièce le garde (l'écran en écrit l'heure, « 24/10 · 10 h 12 »).
    if (doc.createdAt) ev.push({ date: dateOf(doc.createdAt), ts: doc.createdAt, kind: 'cree', label: 'Brouillon créé' });
    if (doc.fromQuoteNumber) ev.push({ date: doc.date, kind: 'devis', label: `Établi à partir du devis ${doc.fromQuoteNumber}`, id: doc.fromQuoteId });
    // Une facture née d'un contrat récurrent le disait nulle part : on retrouve le contrat d'origine,
    // et la ligne est cliquable comme celle d'un devis.
    if (doc.recurringId) {
      const rec = (data.recurring || []).find(r => r.id === doc.recurringId);
      ev.push({
        date: doc.date, kind: 'contrat', contractId: doc.recurringId,
        label: 'Générée par un contrat récurrent',
        detail: rec ? fillTemplate(rec.subject, { mois: monthLabel(doc.date), annee: (doc.date || '').slice(0, 4) }) : 'contrat supprimé depuis'
      });
    }
    // Pièce née d'une autre (proforma d'un devis, bon de livraison d'une commande…) : on le dit et on y renvoie.
    // (la ligne « Établi à partir du devis » ci-dessus couvre déjà le cas devis → facture : on ne la double pas)
    if (doc.fromDocId && !(doc.fromQuoteId === doc.fromDocId && doc.fromQuoteNumber)) ev.push({
      date: doc.date, kind: 'source', id: doc.fromDocId,
      label: `Établi à partir du ${(TITLES[doc.fromDocType] || 'document').toLowerCase()} ${doc.fromDocNumber || '(brouillon)'}`
    });
    // Une facture de plusieurs bons de livraison (brique 86) : chacun des autres, cliquable comme le premier.
    (Array.isArray(doc.bonsLivraison) ? doc.bonsLivraison : []).filter(b => b.id !== doc.fromDocId).forEach(b => ev.push({
      date: doc.date, kind: 'source', id: b.id, label: `Établi à partir du bon de livraison ${b.number || '(brouillon)'}`
    }));
    // Une facture de licence (7.33.0) dit quelle clé elle a portée : la ligne renvoie à la page
    // Licences de l'éditeur, où la clé se copie et se renvoie.
    if (doc.licenceId) {
      const lic = (data.licences || []).find(l => l.id === doc.licenceId);
      ev.push({ date: doc.date, kind: 'licence', label: `Porte la licence n° ${doc.licenceId}`,
        detail: lic ? `${lic.offre === 'independant' ? 'Indépendant' : 'Entreprise'}${lic.exp ? ', jusqu\'au ' + fmtDate(lic.exp) : ', à vie'}` : 'licence introuvable dans l\'historique' });
    }
    if (doc.number && doc.status !== 'brouillon') ev.push({ date: doc.date, ...(doc.issuedTs ? { ts: doc.issuedTs } : {}), kind: 'emis', label: `${TITLES[doc.type]} ${doc.number} ${doc.type === 'facture' ? 'émise' : 'émis'}` });
    // Ce qui en découle : la proforma tirée du devis, le bon de livraison tiré de la commande, etc.
    derivedDocs(doc, data).forEach(d => ev.push({
      date: d.date, kind: 'derive', id: d.id,
      label: `${TITLES[d.type]} ${d.number || '(brouillon)'} établi${d.type === 'facture' || d.type === 'proforma' ? 'e' : ''} à partir de cette pièce`,
      detail: d.status === 'brouillon' ? 'pas encore émis' : ''
    }));
    (doc.attachments || []).forEach(a => ev.push({ date: a.date || '', kind: 'piece', label: 'Pièce jointe : ' + a.name, file: a.file }));
    // Côté devis : les factures qui en sont tirées (conversion, acompte, solde), même encore en brouillon
    if (doc.type === 'devis' && doc.id) (data.documents || []).filter(d => d.type === 'facture' && d.fromQuoteId === doc.id).forEach(inv => {
      const what = inv.deposit ? `Facture d'acompte ${acompteDit(inv.deposit, inv.currency)}` : inv.settles ? 'Facture de solde' : 'Facture';
      ev.push({ date: inv.date, kind: 'facture', label: `${what} ${inv.number || '(brouillon)'} établie`, detail: inv.status === 'brouillon' ? 'pas encore émise' : '', id: inv.id });
    });
    // Un envoi dit son CANAL : « par email » sur un message parti par WhatsApp serait une histoire fausse.
    (doc.emails || []).forEach(e => {
      const par = e.canal === 'whatsapp' ? 'par WhatsApp' : 'par email';
      ev.push({
        date: e.date, kind: /^relance/.test(e.kind) ? 'relance' : 'email',
        label: /^relance/.test(e.kind) ? (REMINDER_LABELS[Number(e.kind.slice(-1))] || 'Relance') + ' ' + par : 'Envoyé ' + par,
        detail: e.to || ''
      });
    });
    (doc.reminders || []).filter(r => r.channel && r.channel !== 'email').forEach(r => ev.push({
      date: r.date, kind: 'relance', label: (REMINDER_LABELS[r.level] || 'Relance') + ' par téléphone', detail: r.note || ''
    }));
    (doc.payments || []).forEach(p => {
      const m = PAYMENT_METHODS.find(x => x[0] === p.method);
      ev.push({ date: p.date, kind: 'paiement', label: estRemboursement(p) ? `Remboursement au client de ${money(-p.amount, doc.currency || company.currency)}` : `Paiement de ${money(p.amount, doc.currency || company.currency)}`, detail: [m ? m[1] : p.method, p.reference].filter(Boolean).join(' · ') });
    });
    if (doc.remindAfter) ev.push({ date: doc.remindAfter, kind: 'report', label: 'Ne pas relancer avant cette date' });
    if (doc.type === 'facture') creditsFor(data, doc.id).forEach(a => ev.push({ date: a.date, kind: 'avoir', label: `Avoir ${a.number}`, detail: a.creditReason || '', id: a.id }));
    if (doc.withholdingCertificate) ev.push({ date: '', kind: 'attestation', label: 'Attestation de retenue à la source reçue' });
    if (doc.status === 'annulée') ev.push({ date: '', kind: 'annule', label: 'Facture marquée annulée' });
    return ev.filter(e => e.date !== undefined).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  }

  // ---------- emails ----------

  const DEFAULT_EMAIL_TEMPLATES = {
    devis: { subject: 'Devis {numero} — {societe}', body: 'Bonjour,\n\nVeuillez trouver ci-joint notre devis {numero} ({montant} TTC) concernant : {objet}.\nIl est valable jusqu\'au {echeance}.\n\nNous restons à votre disposition pour toute question.\n\nCordialement,\n{societe}' },
    // (1.307.0) Un devis changé après l'envoi : le même numéro, une nouvelle version qui remplace la précédente.
    devisModifie: { subject: 'Nouvelle version du devis {numero} — {societe}', body: 'Bonjour,\n\nVoici la nouvelle version de notre devis {numero} ({montant} TTC) concernant : {objet}. Elle remplace celle que nous vous avions envoyée.\nElle est valable jusqu\'au {echeance}.\n\nNous restons à votre disposition pour toute question.\n\nCordialement,\n{societe}' },
    facture: { subject: 'Facture {numero} — {societe}', body: 'Bonjour,\n\nVeuillez trouver ci-joint notre facture {numero}, d\'un montant net à payer de {montant}, à régler avant le {echeance}.\n\nMerci de votre confiance.\n\nCordialement,\n{societe}' },
    avoir: { subject: 'Avoir {numero} — {societe}', body: 'Bonjour,\n\nVeuillez trouver ci-joint l\'avoir {numero} ({montant}) relatif à la facture {reference}.\n\nCordialement,\n{societe}' },
    relance1: { subject: 'Rappel — facture {numero}', body: 'Bonjour,\n\nSauf erreur de notre part, la facture {numero} ({montant}) arrivée à échéance le {echeance} reste en attente de règlement.\nSi le paiement a déjà été effectué, merci de ne pas tenir compte de ce message.\n\nCordialement,\n{societe}' },
    relance2: { subject: 'Relance — facture {numero} en retard de {jours} jours', body: 'Bonjour,\n\nNotre facture {numero} d\'un montant de {montant}, échue le {echeance}, n\'a pas été réglée à ce jour ({jours} jours de retard).\nMerci de procéder au règlement dans les meilleurs délais ou de nous indiquer la date prévue.\n\nCordialement,\n{societe}' },
    relance3: { subject: 'Dernière relance — facture {numero}', body: 'Bonjour,\n\nMalgré nos précédents rappels, la facture {numero} ({montant}, échue le {echeance}) reste impayée après {jours} jours.\nSans règlement sous 8 jours, nous serons contraints d\'engager une procédure de recouvrement.\n\nCordialement,\n{societe}' },
    relanceDevis: { subject: 'Notre devis {numero} — {objet}', body: 'Bonjour,\n\nNous vous avons adressé le devis {numero} ({montant} TTC) concernant : {objet}.\nAvez-vous pu l\'examiner ? Nous restons disponibles pour en discuter ou l\'ajuster si besoin.\n\nCordialement,\n{societe}' },
    comptable: { subject: 'Comptabilité {objet} — {societe}', body: 'Bonjour,\n\nVeuillez trouver ci-joint le journal des ventes de {objet} : {numero} documents, {montant} de chiffre d\'affaires hors taxes.\n\nJe reste à votre disposition pour tout complément.\n\nCordialement,\n{societe}' },
    proforma: { subject: 'Facture proforma {numero} — {societe}', body: 'Bonjour,\n\nVeuillez trouver ci-joint notre facture proforma {numero} d\'un montant de {montant}, concernant : {objet}.\nCe document est établi pour vos démarches : il n\'a pas de valeur comptable et sera suivi d\'une facture définitive.\n\nCordialement,\n{societe}' },
    commande: { subject: 'Bon de commande {numero} — {societe}', body: 'Bonjour,\n\nVeuillez trouver ci-joint le bon de commande {numero} ({montant} TTC) reprenant votre demande concernant : {objet}.\nMerci de nous le retourner daté et signé pour que nous lancions l\'exécution.\n\nCordialement,\n{societe}' },
    livraison: { subject: 'Bon de livraison {numero} — {societe}', body: 'Bonjour,\n\nVeuillez trouver ci-joint le bon de livraison {numero} concernant : {objet}.\nMerci de nous le retourner signé après réception.\n\nCordialement,\n{societe}' },
    contrat: { subject: 'Contrat de prestation {numero} — {societe}', body: 'Bonjour,\n\nVeuillez trouver ci-joint notre contrat de prestation {numero} concernant : {objet}.\nAprès lecture, merci de nous le retourner daté, signé et revêtu de votre cachet.\n\nNous restons à votre disposition pour en discuter les termes.\n\nCordialement,\n{societe}' },
    // La clé de licence envoyée par l'éditeur de SkanFact à son client (7.33.0). `{cle}` est la
    // chaîne « SKAN1.… », `{offre}` et `{fin}` viennent de la licence, `{facture}` est la phrase
    // « Votre facture N est jointe… » — présente SEULEMENT quand la pièce part vraiment avec.
    licence: { subject: 'Votre licence SkanFact — {offre}', body: 'Bonjour,\n\nVoici votre clé de licence SkanFact ({offre}{fin}) :\n\n{cle}\n\nPour l\'activer : dans SkanFact, ouvrez Paramètres → L\'application → Licence, collez la clé en entier (de « SKAN1. » jusqu\'au dernier caractère) et cliquez sur « Enregistrer la clé ». Aucune connexion n\'est nécessaire.\n\n{facture}Merci de votre confiance.\n\nCordialement,\n{societe}' },
    // 9.4.1 — la clé d'un CABINET se colle dans SkanFact Cabinet, pas dans SkanFact : le chemin
    // d'activation est celui de ses Réglages, et `{quota}` remplace l'offre. La console
    // (`mailLicence`) écrit la même phrase, et un test les compare.
    licenceCabinet: { subject: 'Votre licence SkanFact Cabinet — {quota}', body: 'Bonjour,\n\nVoici votre clé de licence SkanFact Cabinet ({quota} hors SkanFact en plus des trois gratuits{fin}) :\n\n{cle}\n\nPour l\'activer : dans SkanFact Cabinet, ouvrez Réglages → Mon cabinet → Licence, collez la clé en entier (de « SKAN1. » jusqu\'au dernier caractère) et cliquez sur « Enregistrer la clé ». Aucune connexion n\'est nécessaire.\n\n{facture}Merci de votre confiance.\n\nCordialement,\n{societe}' }
  };

  const DEFAULT_EMAIL_TEMPLATES_EN = {
    devis: { subject: 'Quote {numero} — {societe}', body: 'Hello,\n\nPlease find attached our quote {numero} ({montant} incl. VAT) for: {objet}.\nIt is valid until {echeance}.\n\nWe remain at your disposal for any question.\n\nBest regards,\n{societe}' },
    devisModifie: { subject: 'New version of quote {numero} — {societe}', body: 'Hello,\n\nHere is the new version of our quote {numero} ({montant} incl. VAT) for: {objet}. It replaces the one we sent you.\nIt is valid until {echeance}.\n\nWe remain at your disposal for any question.\n\nBest regards,\n{societe}' },
    facture: { subject: 'Invoice {numero} — {societe}', body: 'Hello,\n\nPlease find attached our invoice {numero} for {montant}, due by {echeance}.\n\nThank you for your trust.\n\nBest regards,\n{societe}' },
    avoir: { subject: 'Credit note {numero} — {societe}', body: 'Hello,\n\nPlease find attached credit note {numero} ({montant}) related to invoice {reference}.\n\nBest regards,\n{societe}' },
    relance1: { subject: 'Reminder — invoice {numero}', body: 'Hello,\n\nUnless we are mistaken, invoice {numero} ({montant}) due on {echeance} is still awaiting payment.\nIf you have already paid, please disregard this message.\n\nBest regards,\n{societe}' },
    relance2: { subject: 'Second reminder — invoice {numero} is {jours} days overdue', body: 'Hello,\n\nOur invoice {numero} for {montant}, due on {echeance}, remains unpaid ({jours} days overdue).\nPlease proceed with payment as soon as possible or let us know the expected date.\n\nBest regards,\n{societe}' },
    relance3: { subject: 'Final reminder — invoice {numero}', body: 'Hello,\n\nDespite our previous reminders, invoice {numero} ({montant}, due on {echeance}) remains unpaid after {jours} days.\nWithout payment within 8 days, we will have to start a recovery procedure.\n\nBest regards,\n{societe}' },
    relanceDevis: { subject: 'Our quote {numero} — {objet}', body: 'Hello,\n\nWe sent you quote {numero} ({montant} incl. VAT) for: {objet}.\nHave you had a chance to review it? We remain available to discuss or adjust it.\n\nBest regards,\n{societe}' },
    comptable: { subject: 'Accounting {objet} — {societe}', body: 'Hello,\n\nPlease find attached the sales journal for {objet}.\n\nBest regards,\n{societe}' },
    // L'interface de SkanFact est en français : le mail anglais cite les libellés RÉELS des menus,
    // avec leur traduction — un client anglophone doit pouvoir les retrouver à l'écran.
    licence: { subject: 'Your SkanFact licence — {offre}', body: 'Hello,\n\nHere is your SkanFact licence key ({offre}{fin}):\n\n{cle}\n\nTo activate it: in SkanFact, open « Paramètres → L\'application → Licence » (Settings → The application → Licence), paste the whole key (from "SKAN1." to the last character) and click « Enregistrer la clé » (Save the key). No internet connection is needed.\n\n{facture}Thank you for your trust.\n\nBest regards,\n{societe}' },
    licenceCabinet: { subject: 'Your SkanFact Cabinet licence — {quota}', body: 'Hello,\n\nHere is your SkanFact Cabinet licence key ({quota} outside SkanFact, on top of the three free ones{fin}):\n\n{cle}\n\nTo activate it: in SkanFact Cabinet, open « Réglages → Mon cabinet → Licence » (Settings → My firm → Licence), paste the whole key (from "SKAN1." to the last character) and click « Enregistrer la clé » (Save the key). No internet connection is needed.\n\n{facture}Thank you for your trust.\n\nBest regards,\n{societe}' }
  };
  // 10.14.1 (MR-09) — une profession libérale émet une NOTE D'HONORAIRES (7.22.0) : la pièce s'appelait
  // ainsi, et le mail qui l'emportait disait « Facture FAC-… » et « notre facture ». Mêmes phrases, le nom
  // de la pièce changé ; un modèle que la personne a RÉÉCRIT reste le sien (`modeleMail`).
  const MODELES_HONORAIRES = {
    facture: { subject: 'Note d\'honoraires {numero} — {societe}', body: 'Bonjour,\n\nVeuillez trouver ci-joint notre note d\'honoraires {numero}, d\'un montant net à payer de {montant}, à régler avant le {echeance}.\n\nMerci de votre confiance.\n\nCordialement,\n{societe}' },
    avoir: { subject: 'Avoir {numero} — {societe}', body: 'Bonjour,\n\nVeuillez trouver ci-joint l\'avoir {numero} ({montant}) relatif à la note d\'honoraires {reference}.\n\nCordialement,\n{societe}' },
    relance1: { subject: 'Rappel — note d\'honoraires {numero}', body: 'Bonjour,\n\nSauf erreur de notre part, la note d\'honoraires {numero} ({montant}) arrivée à échéance le {echeance} reste en attente de règlement.\nSi le paiement a déjà été effectué, merci de ne pas tenir compte de ce message.\n\nCordialement,\n{societe}' },
    relance2: { subject: 'Relance — note d\'honoraires {numero} en retard de {jours} jours', body: 'Bonjour,\n\nNotre note d\'honoraires {numero} d\'un montant de {montant}, échue le {echeance}, n\'a pas été réglée à ce jour ({jours} jours de retard).\nMerci de procéder au règlement dans les meilleurs délais ou de nous indiquer la date prévue.\n\nCordialement,\n{societe}' },
    relance3: { subject: 'Dernière relance — note d\'honoraires {numero}', body: 'Bonjour,\n\nMalgré nos précédents rappels, la note d\'honoraires {numero} ({montant}, échue le {echeance}) reste impayée après {jours} jours.\nSans règlement sous 8 jours, nous serons contraints d\'engager une procédure de recouvrement.\n\nCordialement,\n{societe}' }
  };
  const MODELES_HONORAIRES_EN = {
    facture: { subject: 'Fee note {numero} — {societe}', body: 'Hello,\n\nPlease find attached our fee note {numero} for {montant}, due by {echeance}.\n\nThank you for your trust.\n\nBest regards,\n{societe}' },
    avoir: { subject: 'Credit note {numero} — {societe}', body: 'Hello,\n\nPlease find attached credit note {numero} ({montant}) related to fee note {reference}.\n\nBest regards,\n{societe}' },
    relance1: { subject: 'Reminder — fee note {numero}', body: 'Hello,\n\nUnless we are mistaken, fee note {numero} ({montant}) due on {echeance} is still awaiting payment.\nIf you have already paid, please disregard this message.\n\nBest regards,\n{societe}' },
    relance2: { subject: 'Second reminder — fee note {numero} is {jours} days overdue', body: 'Hello,\n\nOur fee note {numero} for {montant}, due on {echeance}, remains unpaid ({jours} days overdue).\nPlease proceed with payment as soon as possible or let us know the expected date.\n\nBest regards,\n{societe}' },
    relance3: { subject: 'Final reminder — fee note {numero}', body: 'Hello,\n\nDespite our previous reminders, fee note {numero} ({montant}, due on {echeance}) remains unpaid after {jours} days.\nWithout payment within 8 days, we will have to start a recovery procedure.\n\nBest regards,\n{societe}' }
  };
  // Les modèles par défaut de CETTE entreprise : ceux d'une profession libérale nomment sa pièce.
  function modelesParDefaut(company, en) {
    const base = en ? DEFAULT_EMAIL_TEMPLATES_EN : DEFAULT_EMAIL_TEMPLATES;
    return estLiberal(company) ? { ...base, ...(en ? MODELES_HONORAIRES_EN : MODELES_HONORAIRES) } : base;
  }
  // Le modèle d'un envoi. Les Paramètres rangent TOUS les modèles, y compris ceux qu'on n'a pas touchés :
  // un modèle resté identique au texte d'origine n'est pas un choix, il suit le métier. Un modèle réécrit
  // à la main, même d'un seul mot, reste celui de la personne.
  function modeleMail(company, kind, en) {
    const co = company || {};
    const base = en ? DEFAULT_EMAIL_TEMPLATES_EN : DEFAULT_EMAIL_TEMPLATES;
    const defs = modelesParDefaut(co, en);
    const perso = (en ? co.emailTemplatesEn : co.emailTemplates) || {};
    const k = defs[kind] ? kind : 'facture';
    const d = defs[k], b = base[k] || {}, p = perso[k] || {};
    const pick = f => (p[f] === undefined || p[f] === null || p[f] === b[f] || p[f] === d[f]) ? d[f] : p[f];
    return { subject: pick('subject'), body: pick('body') };
  }


  // `data` (10.14.1) : une RELANCE réclame ce qui reste dû, jamais le total — une facture de 1 190 DT
  // payée de 1 000 partait « d'un montant de 1 190,000 DT… n'a pas été réglée », au client qui venait
  // de verser 1 000. Et le montant s'écrit dans la langue du mail, comme sur le PDF joint : « 1,190.29
  // EUR » dans un mail anglais, jamais « 1 190,29 ».
  function emailFor(kind, doc, client, company, extra, data) {
    const en = (doc.lang || (client && client.lang) || company.defaultLang) === 'en';
    const tpl = modeleMail(company, kind, en);
    const t = computeTotals(doc, company);
    const cur = doc.currency || company.currency || 'DT';
    const relance = /^relance\d$/.test(kind) && doc.type === 'facture' && data;
    const du = relance ? invoiceBalance(doc, data, company).remaining : (doc.type === 'devis' ? t.totalTTC : t.netToPay);
    const vars = {
      numero: doc.number || 'brouillon', objet: doc.subject || '', client: (client || {}).name || '', societe: company.name,
      montant: money(du, cur, undefined, en ? 'en' : 'fr'), echeance: fmtDate(doc.dueDate), reference: doc.creditOfNumber || doc.reference || '',
      ...(extra || {})
    };
    const modele = sansObjetVide(vars);
    return { to: (client || {}).email || '', subject: fillTemplate(modele(tpl.subject), vars), body: fillTemplate(modele(tpl.body), vars) };
  }

  // L'objet d'une pièce est FACULTATIF, et le modèle l'écrivait quand même : « notre devis DEV-2026-001
  // (1 011,500 DT TTC) concernant : . » partait chez le client, et « Notre devis DEV-2026-001 — » en
  // objet d'une relance (10.14.0, vu en faisant le premier envoi d'une entreprise neuve). Quand l'objet
  // est vide, on retire la proposition qui le porte — dans le MODÈLE, avant de le remplir : un texte que
  // la personne a écrit elle-même ne se réécrit jamais, et un « concernant : » qu'elle aurait tapé en
  // dehors de `{objet}` reste le sien. Un `{objet}` posé ailleurs dans un modèle personnel devient vide,
  // comme avant.
  function sansObjetVide(vars) {
    const vide = !String((vars && vars.objet) || '').trim();
    return s => !vide ? s : String(s || '')
      .replace(/,?[ \t]*(?:reprenant votre demande[ \t]+)?concernant[ \t]*:[ \t]*\{objet\}/g, '')
      .replace(/[ \t]*for:[ \t]*\{objet\}/g, '')
      .replace(/[ \t]*—[ \t]*\{objet\}/g, '');
  }

  // ---------- WhatsApp (10.15.0, H2 de l'étude Hesabi) ----------
  // Le canal réel en Tunisie. WhatsApp veut le numéro au format international, sans « + » ni espace
  // (21698123456) : un numéro tunisien s'écrit de huit chiffres, on lui met l'indicatif ; un numéro
  // étranger se tape avec le sien (+33…, 0033…) — sans lui on ne devine pas le pays, on le DIT.
  // Un fixe tunisien commence par 7 et n'a en général pas WhatsApp : on le signale sans refuser
  // (un standard peut avoir WhatsApp Business) — À VÉRIFIER avec le client.
  function numeroWhatsApp(tel) {
    const brut = String(tel == null ? '' : tel).trim();
    if (!brut) return { ok: false, vide: true, motif: 'aucun numéro de téléphone' };
    let v = brut.replace(/[\s().\-/]/g, '');
    if (!/^\+?\d+$/.test(v)) return { ok: false, motif: `« ${brut} » n'est pas un numéro que WhatsApp reconnaît : huit chiffres pour la Tunisie, ou l'indicatif du pays devant (+33…)` };
    if (/^\+/.test(v)) v = v.slice(1);
    else if (/^00/.test(v)) v = v.slice(2);
    else if (/^\d{8}$/.test(v)) v = '216' + v;
    // Sans « + » ni « 00 », seul un numéro tunisien se reconnaît : « 06 12 34 56 78 » est un numéro
    // national d'un AUTRE pays, et l'envoyer tel quel ouvrirait une conversation avec personne.
    else if (/^216/.test(v) && v.length !== 11) return { ok: false, motif: `« ${brut} » : un numéro tunisien a huit chiffres après l'indicatif 216` };
    else if (!/^216\d{8}$/.test(v)) return { ok: false, motif: `« ${brut} » : ajoute l'indicatif du pays devant (+33…, 00216…) — sans lui, on ne sait pas à qui il appartient` };
    if (!/^\d{8,15}$/.test(v)) return { ok: false, motif: `« ${brut} » n'est pas un numéro que WhatsApp reconnaît : huit chiffres pour la Tunisie, ou l'indicatif du pays devant (+33…)` };
    if (/^216/.test(v) && v.length !== 11) return { ok: false, motif: `« ${brut} » : un numéro tunisien a huit chiffres après l'indicatif 216` };
    return { ok: true, numero: v, fixe: /^2167/.test(v) };
  }
  // Le lien qui ouvre la conversation, message prérempli. Un lien ne porte pas de fichier : le PDF se
  // glisse à la main, et l'écran le dit.
  function lienWhatsApp(numero, texte) {
    return 'https://wa.me/' + String(numero) + (texte ? '?text=' + encodeURIComponent(texte) : '');
  }

  // ---------- montant en lettres (français) ----------

  const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
    'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

  // « Quatre-vingts » et « deux cents » ne prennent leur s qu'en FIN de nombre (10.14.1, MR-08) : devant
  // « mille », adjectif numéral, ils restent au singulier — « quatre-vingt mille », « deux cent mille ».
  // Devant « million » et « milliard », qui sont des noms, ils le gardent. `fin` le dit.
  function below100(n, fin = true) {
    if (n < 20) return UNITS[n];
    const t = Math.floor(n / 10), u = n % 10;
    if (t === 7 || t === 9) {
      const rest = UNITS[10 + u];
      return TENS[t] + (u === 1 && t === 7 ? ' et ' : '-') + rest;
    }
    if (u === 0) return TENS[t] + (t === 8 && fin ? 's' : '');
    if (u === 1 && t !== 8) return TENS[t] + ' et un';
    return TENS[t] + '-' + UNITS[u];
  }

  function below1000(n, fin = true) {
    const h = Math.floor(n / 100), r = n % 100;
    let s = '';
    if (h === 1) s = 'cent';
    else if (h > 1) s = UNITS[h] + ' cent' + (r === 0 && fin ? 's' : '');
    if (r) s += (s ? ' ' : '') + below100(r, fin);
    return s;
  }

  function intToWords(n) {
    n = Math.floor(Math.abs(n));
    if (n === 0) return 'zéro';
    const parts = [];
    const scales = [[1e9, 'milliard', 'milliards'], [1e6, 'million', 'millions'], [1e3, 'mille', 'mille']];
    for (const [val, sing, plur] of scales) {
      if (n >= val) {
        const q = Math.floor(n / val);
        n %= val;
        if (val === 1e3 && q === 1) parts.push('mille');
        else parts.push(below1000(q, val !== 1e3) + ' ' + (q > 1 ? plur : sing));
      }
    }
    if (n) parts.push(below1000(n));
    return parts.join(' ');
  }

  // ---------- montant en lettres (anglais) ----------

  const UNITS_EN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS_EN = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function below1000En(n) {
    const h = Math.floor(n / 100), r = n % 100;
    let s = h ? UNITS_EN[h] + ' hundred' : '';
    if (r) s += (s ? ' and ' : '') + (r < 20 ? UNITS_EN[r] : TENS_EN[Math.floor(r / 10)] + (r % 10 ? '-' + UNITS_EN[r % 10] : ''));
    return s;
  }
  function intToWordsEn(n) {
    n = Math.floor(Math.abs(n));
    if (n === 0) return 'zero';
    const parts = [];
    [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']].forEach(([val, name]) => { if (n >= val) { parts.push(below1000En(Math.floor(n / val)) + ' ' + name); n %= val; } });
    if (n) parts.push(below1000En(n));
    return parts.join(' ');
  }

  // Unités monétaires : [singulier, pluriel, sous-unité singulier, pluriel, diviseur]
  const CURRENCY_WORDS = {
    fr: { DT: ['dinar', 'dinars', 'millime', 'millimes', 1000], TND: ['dinar', 'dinars', 'millime', 'millimes', 1000], EUR: ['euro', 'euros', 'centime', 'centimes', 100], USD: ['dollar', 'dollars', 'cent', 'cents', 100], GBP: ['livre', 'livres', 'penny', 'pence', 100], CHF: ['franc', 'francs', 'centime', 'centimes', 100], MAD: ['dirham', 'dirhams', 'centime', 'centimes', 100], DZD: ['dinar', 'dinars', 'centime', 'centimes', 100] },
    en: { DT: ['dinar', 'dinars', 'millime', 'millimes', 1000], TND: ['dinar', 'dinars', 'millime', 'millimes', 1000], EUR: ['euro', 'euros', 'cent', 'cents', 100], USD: ['dollar', 'dollars', 'cent', 'cents', 100], GBP: ['pound', 'pounds', 'penny', 'pence', 100], CHF: ['franc', 'francs', 'centime', 'centimes', 100], MAD: ['dirham', 'dirhams', 'centime', 'centimes', 100], DZD: ['dinar', 'dinars', 'centime', 'centimes', 100] }
  };

  function amountToWords(amount, currency, lang) {
    const cur = currency || 'DT';
    const en = lang === 'en';
    const w = (CURRENCY_WORDS[en ? 'en' : 'fr'][cur]) || [cur, cur, en ? 'cent' : 'centime', en ? 'cents' : 'centimes', 100];
    // On compte en SOUS-UNITÉS entières (10.14.1) : arrondi au centime d'abord, puis séparé. Séparer
    // puis arrondir écrivait « cent dix-neuf euros et cent centimes » sous « 120,00 EUR ».
    const total = Math.round(round3(Math.abs(amount)) * w[4] * (1 + 4 * Number.EPSILON));
    const d = Math.floor(total / w[4]);
    const m = total - d * w[4];
    const words = en ? intToWordsEn : intToWords;
    // « Un million DE dinars », « deux milliards D'euros » : un nombre qui finit par million ou milliard
    // (des noms) se lie à l'unité par « de » ; « un million deux cent mille dinars », non.
    const unite = d > 1 ? w[1] : w[0];
    const de = !en && d >= 1e6 && d % 1e6 === 0 ? (/^[aeiouyéè]/i.test(unite) ? 'd\'' : 'de ') : '';
    let s = words(d) + ' ' + de + unite;
    if (m) s += (en ? ' and ' : ' et ') + words(m) + ' ' + (m > 1 ? w[3] : w[2]);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ---------- template HTML (aperçu + PDF) ----------

  const I18N = {
    fr: {
      devis: 'Devis', facture: 'Facture', avoir: 'Avoir', issuedF: 'Émise le', issued: 'Émis le', dueBy: 'À régler avant le', payOnReceipt: 'À régler à réception', validUntil: 'Valable jusqu\'au',
      deposit: 'Acompte', depositOf: '% du devis', depositAmountOf: 'TTC du devis', balance: 'Solde', balanceOf: 'du devis', afterQuote: 'Suite au devis', reference: 'Référence', cancels: 'Annule / rectifie',
      billedTo: 'Facturé à', preparedFor: 'Préparé pour', client: 'Client', subject: 'Objet', designation: 'Désignation', qty: 'Qté', unitPrice: 'Prix unit. HT', vat: 'TVA', lineTotal: 'Total HT', lineDiscount: 'Remise', exportMention: 'Vente à l\'exportation : exonérée de TVA (art. 18 du code de la TVA), sans droit de timbre.',
      payment: 'Règlement', bank: 'Banque', rib: 'RIB', motif: 'Motif', creditText: (n, nom) => `Cet avoir vient en déduction de ${nom || 'la facture'} ${n}`, creditFreeText: 'Cet avoir n\'est rattaché à aucune facture : il est à valoir sur une prochaine facture, ou remboursé', conditions: 'Conditions', validText: d => `Devis valable jusqu'au ${d}.`,
      subtotal: 'Total HT', discount: 'Remise', netHT: 'Net HT', on: 'sur', stamp: 'Timbre fiscal', totalTTC: 'Total TTC', withholding: 'Retenue à la source', exoRS: (n, d) => `Exonéré de la retenue à la source${n ? ` — attestation n°\u00a0${n}` : ''}, valable jusqu'au ${d}.`, netToPay: 'Net à payer', creditAmount: 'Montant de l\'avoir',
      wordsInvoice: 'Arrêtée la présente facture à la somme de', wordsFees: 'Arrêtée la présente note d\'honoraires à la somme de', wordsCredit: 'Arrêté le présent avoir à la somme de', wordsQuote: 'Arrêté le présent devis à la somme de', wordsDoc: 'Arrêté le présent document à la somme de',
      approve: 'Bon pour accord', approveSub: 'Date, signature et cachet du client', stampSign: 'Cachet et signature', provider: 'Le prestataire', draft: 'Brouillon', paid: 'Payée', cancelled: 'Annulée', mf: 'MF', mfCin: 'MF / CIN', rate: 'Taux',
      proforma: 'Facture proforma', commande: 'Bon de commande', livraison: 'Bon de livraison', contrat: 'Contrat de prestation',
      established: 'Établi le', orderedOn: 'Commandé le', deliveredOn: 'Livré le', signedOn: 'Signé le', from: 'Suite à', deliveryNotes: 'Bons de livraison', deliveryNote1: 'Bon de livraison',
      commandeFournisseur: 'Bon de commande', supplier: 'Fournisseur', wantedBy: 'Livraison souhaitée le',
      demandePrix: 'Demande de prix', askedOn: 'Demandé le',
      demandePrixNote: 'Merci de nous indiquer vos prix unitaires hors taxes et votre délai de livraison pour ces articles.',
      supplierOrderNote: 'Merci de nous confirmer cette commande, ses prix et sa date de livraison. Toute livraison est accompagnée de son bon de livraison.',
      proformaNote: 'Document sans valeur comptable. Il ne remplace pas une facture et ne donne lieu à aucune déclaration de TVA.',
      orderNote: 'Bon de commande établi d\'après votre demande. Merci de nous le retourner daté et signé pour lancer l\'exécution.',
      deliveryNote: 'Marchandises et prestations livrées au client. À signer à la réception.',
      received: 'Reçu conforme', receivedSub: 'Date, nom et signature du réceptionnaire',
      orderApprove: 'Bon pour commande', contractClient: 'Le client', contractProvider: 'Le prestataire',
      contractSub: 'Lu et approuvé, date et signature', contractIntro: 'Entre les soussignés', totalNoTax: 'Total HT'
    },
    en: {
      devis: 'Quote', facture: 'Invoice', avoir: 'Credit note', issuedF: 'Issued on', issued: 'Issued on', dueBy: 'Due by', payOnReceipt: 'Payable on receipt', validUntil: 'Valid until',
      deposit: 'Deposit', depositOf: '% of quote', depositAmountOf: 'incl. VAT, of quote', balance: 'Balance', balanceOf: 'of quote', afterQuote: 'Following quote', reference: 'Reference', cancels: 'Cancels / corrects',
      billedTo: 'Billed to', preparedFor: 'Prepared for', client: 'Client', subject: 'Subject', designation: 'Description', qty: 'Qty', unitPrice: 'Unit price', vat: 'VAT', lineTotal: 'Total excl. VAT', lineDiscount: 'Disc.', exportMention: 'Export sale: exempt from VAT (art. 18 of the Tunisian VAT code), no stamp duty.',
      payment: 'Payment', bank: 'Bank', rib: 'Account (RIB)', motif: 'Reference', creditText: (n, nom) => `This credit note is deducted from ${nom || 'invoice'} ${n}`, creditFreeText: 'This credit note is not attached to any invoice: it may be applied to a future invoice, or refunded', conditions: 'Terms', validText: d => `This quote is valid until ${d}.`,
      subtotal: 'Subtotal excl. VAT', discount: 'Discount', netHT: 'Net excl. VAT', on: 'on', stamp: 'Stamp duty', totalTTC: 'Total incl. VAT', withholding: 'Withholding tax', exoRS: (n, d) => `Exempt from withholding tax${n ? ` — certificate no.\u00a0${n}` : ''}, valid until ${d}.`, netToPay: 'Amount due', creditAmount: 'Credit amount',
      wordsInvoice: 'Total amount in words:', wordsFees: 'Total amount in words:', wordsCredit: 'Total amount in words:', wordsQuote: 'Total amount in words:', wordsDoc: 'Total amount in words:',
      approve: 'Approved — signature', approveSub: 'Date, signature and stamp of the client', stampSign: 'Stamp and signature', provider: 'Provider', draft: 'Draft', paid: 'Paid', cancelled: 'Cancelled', mf: 'Tax ID', mfCin: 'Tax ID', rate: 'Rate',
      proforma: 'Proforma invoice', commande: 'Purchase order', livraison: 'Delivery note', contrat: 'Service agreement',
      established: 'Issued on', orderedOn: 'Ordered on', deliveredOn: 'Delivered on', signedOn: 'Signed on', from: 'Following', deliveryNotes: 'Delivery notes', deliveryNote1: 'Delivery note',
      commandeFournisseur: 'Purchase order', supplier: 'Supplier', wantedBy: 'Delivery requested by',
      demandePrix: 'Request for quotation', askedOn: 'Requested on',
      demandePrixNote: 'Please send us your unit prices excluding tax and your delivery lead time for these items.',
      supplierOrderNote: 'Please confirm this order, its prices and its delivery date. Every delivery comes with its delivery note.',
      proformaNote: 'This document has no accounting value. It does not replace an invoice and is not subject to VAT reporting.',
      orderNote: 'Purchase order drawn up from your request. Please return it dated and signed so we can proceed.',
      deliveryNote: 'Goods and services delivered to the client. To be signed on receipt.',
      received: 'Received in good order', receivedSub: 'Date, name and signature of the recipient',
      orderApprove: 'Approved — order', contractClient: 'The client', contractProvider: 'The provider',
      contractSub: 'Read and approved, date and signature', contractIntro: 'Between the undersigned', totalNoTax: 'Total excl. VAT'
    }
  };

  function documentHtml(doc, client, company, opts) {
    // Le client de passage (une facture sans fiche) : le nom et l'identifiant tapés sur la pièce.
    if (!client && doc && doc.passage) client = { name: doc.passage.nom || 'Client de passage', matricule: doc.passage.matricule || '' };
    opts = opts || {};
    const t = computeTotals(doc, company);
    const lang = (doc.lang || company.defaultLang) === 'en' ? 'en' : 'fr';
    const L = I18N[lang];
    const cur = doc.currency || company.currency || 'DT';
    const dec = decimalsFor(cur);
    const fmt = n => money(n, null, dec, lang);
    const isInvoice = doc.type === 'facture';
    const isCredit = doc.type === 'avoir';
    const isQuote = doc.type === 'devis';
    const isProforma = doc.type === 'proforma';
    const isOrder = doc.type === 'commande';
    // La commande qu'on passe à un fournisseur (brique 87) : elle s'imprime comme un bon de commande, pour lui.
    const isSupplierOrder = doc.type === 'commandeFournisseur';
    // Une demande de prix (brique 89) : les mêmes lignes, sans prix ; c'est au fournisseur de les donner.
    const isDemandePrix = isSupplierOrder && doc.status === 'demande';
    const isDelivery = doc.type === 'livraison';
    const isContract = doc.type === 'contrat';
    // Le bon de livraison accompagne la marchandise : par défaut il ne porte aucun prix.
    const noPrices = (isDelivery && doc.hidePrices !== false) || isDemandePrix;
    const clauses = isContract ? { ...DEFAULT_CLAUSES, ...(doc.clauses || {}) } : null;
    // Le titre imprimé. Pour une profession libérale, « Facture » devient « Note d'honoraires » —
    // même pièce, même numéro, même valeur comptable, le nom que le client attend.
    const title = (doc.type === 'facture' && estLiberal(company))
      ? docLabel('facture', company, lang) : isDemandePrix ? L.demandePrix : (L[doc.type] || 'Document');
    const cl = client || {};
    const ink = company.primaryColor || '#1b2430';
    const accent = company.accentColor || '#0f9d8f';
    const numberText = doc.number || L.draft;
    const stampKey = opts.stamp || ({ 'Payée': 'paid', 'Annulée': 'cancelled', 'Brouillon': 'draft' })[opts.stampText] || (opts.stampText ? 'custom' : (!isQuote && !isContract && doc.status === 'brouillon' ? 'draft' : null));
    const stampText = stampKey === 'custom' ? opts.stampText : (stampKey ? L[stampKey] : '');
    const multiVat = Object.keys(t.vatByRate).length > 1;
    // La colonne TVA (7.22.0). Elle tombe quand l'entreprise n'est pas assujettie — mais JAMAIS
    // quand la pièce en porte : une facture émise sous le régime réel garde sa colonne pour
    // toujours, même si l'entreprise passe au forfaitaire l'année suivante. Une pièce émise ne se
    // réécrit pas (règle 7.1.0), et le PDF chez le client ferait foi contre nous.
    const coTva = regimePourPiece(doc, company);
    const showVat = assujettiTVA(coTva) || t.totalVAT > 0;
    const mentionSansTva = showVat ? '' : mentionTVA(coTva, lang);
    // L'exonération de retenue de l'entreprise (10.15.0, H7), sur une facture qui n'en porte aucune.
    const exoRS = mentionExonerationRS(doc, company);
    const pct = n => String(n).replace('.', lang === 'en' ? '.' : ',');
    const foreign = cur !== (company.currency || 'DT') && Number(doc.exchangeRate) > 0;

    // teinte claire dérivée de l'accent (mélange avec du blanc)
    const hex = accent.replace('#', '');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    const tint = (a) => `rgba(${r}, ${g}, ${b}, ${a})`;

    // (1.155.0) Une colonne « Remise » quand une ligne a la sienne ; une ligne de titre ouvre une section et porte son
    // sous-total HT (maquette de la facture, « Lignes de titre et sous-totaux par section »).
    const remiseLigne = !noPrices && t.lines.some(l => !l.titre && Number(l.discount) > 0);
    const sousTotaux = t.lines.some(l => l.titre) ? sousTotauxDeSections(doc, company) : {};
    const nbCols = 2 + (noPrices ? 0 : 2 + (showVat ? 1 : 0) + (remiseLigne ? 1 : 0));
    const linesHtml = t.lines.map((l, i) => l.titre ? `
      <tr class="titre">
        <td colspan="${nbCols - (noPrices ? 0 : 1)}"><div class="lbl">${escapeHtml(l.label)}</div></td>
        ${noPrices ? '' : `<td class="r num strong">${fmt(sousTotaux[i] || 0)}</td>`}
      </tr>` : `
      <tr>
        <td>
          <div class="lbl">${escapeHtml(l.label)}</div>
          ${l.description ? `<div class="desc">${nl2br(l.description)}</div>` : ''}
        </td>
        <td class="r num">${escapeHtml(String(l.qty).replace('.', lang === 'en' ? '.' : ','))}${l.unit ? `<span class="unit"> ${escapeHtml(l.unit)}</span>` : ''}</td>
        ${noPrices ? '' : `<td class="r num">${fmt(l.unitPrice)}</td>
        ${remiseLigne ? `<td class="r num dim">${Number(l.discount) > 0 ? pct(Number(l.discount)) + '%' : '—'}</td>` : ''}
        ${showVat ? `<td class="r num dim">${l.vatRate}%</td>` : ''}
        <td class="r num strong">${fmt(l.ht)}</td>`}
      </tr>`).join('');

    // 10.12.0 — un délai de 0 jour : « À régler avant le 24/09 » sous « Émise le 24/09 » se lit
    // comme un délai impossible. La mention d'usage est « à réception », et c'est la même date.
    // 10.14.1 (S-05) — et elle se lit dans le MÊME cadre que la date : deux cadres côte à côte,
    // « Émise le 24/09 » et « À régler : à réception », disaient deux fois la même chose, et le
    // second faisait chercher une seconde date qui n'existait pas.
    const aReception = d => !!(d.dueDate && d.dueDate === d.date);
    const dueCard = d => aReception(d) ? null : [L.dueBy, fmtDate(d.dueDate)];
    const metaItems = isInvoice ? [
      [L.issuedF, fmtDate(doc.date), aReception(doc) ? L.payOnReceipt : ''],
      dueCard(doc),
      doc.deposit ? [L.deposit, doc.deposit.montant ? `${money(doc.deposit.montant, cur, undefined, lang)} ${L.depositAmountOf} ${doc.deposit.quoteNumber}` : `${pct(doc.deposit.percent)} ${L.depositOf} ${doc.deposit.quoteNumber}`] : (doc.settles ? [L.balance, `${L.balanceOf} ${doc.settles.quoteNumber}`] : (doc.fromQuoteNumber ? [L.afterQuote, doc.fromQuoteNumber] : null)),
      // Les bons de livraison qu'elle regroupe (brique 86) : le client rapproche la facture de ses bons signés.
      Array.isArray(doc.bonsLivraison) && doc.bonsLivraison.length
        ? [doc.bonsLivraison.length > 1 ? L.deliveryNotes : L.deliveryNote1, doc.bonsLivraison.map(b => b.number).filter(Boolean).join(', ')] : null,
      doc.reference ? [L.reference, doc.reference] : null
    ] : isCredit ? [
      [L.issued, fmtDate(doc.date)],
      doc.creditOfNumber ? [L.cancels, docLabel('facture', company, lang) + ' ' + doc.creditOfNumber] : null,
      doc.reference ? [L.reference, doc.reference] : null
    ] : isProforma ? [
      [L.established, fmtDate(doc.date), aReception(doc) ? L.payOnReceipt : ''],
      doc.dueDate ? dueCard(doc) : null,
      doc.fromDocNumber ? [L.from, doc.fromDocNumber] : null,
      doc.reference ? [L.reference, doc.reference] : null
    ] : isOrder ? [
      [L.orderedOn, fmtDate(doc.date)],
      doc.fromDocNumber ? [L.from, doc.fromDocNumber] : null,
      doc.reference ? [L.reference, doc.reference] : null
    ] : isDelivery ? [
      [L.deliveredOn, fmtDate(doc.date)],
      doc.fromDocNumber ? [L.from, doc.fromDocNumber] : null,
      doc.reference ? [L.reference, doc.reference] : null
    ] : isSupplierOrder ? [
      [isDemandePrix ? L.askedOn : L.orderedOn, fmtDate(doc.date)],
      doc.dueDate ? [L.wantedBy, fmtDate(doc.dueDate)] : null,
      doc.reference ? [L.reference, doc.reference] : null
    ] : isContract ? [
      [L.established, fmtDate(doc.date)],
      doc.fromDocNumber ? [L.from, doc.fromDocNumber] : null,
      doc.reference ? [L.reference, doc.reference] : null
    ] : [
      [L.issued, fmtDate(doc.date)],
      [L.validUntil, fmtDate(doc.dueDate)],
      doc.reference ? [L.reference, doc.reference] : null
    ];
    // 10.12.0 — le taux s'écrivait à la française (« 3,350 DT ») au milieu d'un document anglais qui
    // écrit « 1,200.00 » : c'était le seul montant du modèle à oublier la langue de la pièce.
    if (foreign) metaItems.push([L.rate, `1 ${cur} = ${money(doc.exchangeRate, company.currency, null, lang)}`]);
    const meta = metaItems.filter(Boolean).map(([k, v, sous]) => `<div class="chip"><span class="ck">${escapeHtml(k)}</span><span class="cv">${escapeHtml(v)}</span>${sous ? `<span class="cs">${escapeHtml(sous)}</span>` : ''}</div>`).join('');

    // Sans TVA, la mention légale prend la PLACE de la ligne de TVA, là où le lecteur la cherche.
    // Une facture sans TVA et sans mention n'est pas une facture allégée, c'est une facture
    // incomplète — et c'est le client, ou son comptable, qui la refuse.
    // (1.155.0) Une vente à l'exportation dit sa mention à la place de la TVA (À VÉRIFIER : le libellé exact).
    const vatRows = doc.export === true ? `<tr><td colspan="2" class="dim">${escapeHtml(L.exportMention)}</td></tr>`
      : !showVat
      ? (mentionSansTva ? `<tr><td colspan="2" class="dim">${escapeHtml(mentionSansTva)}</td></tr>` : '')
      : multiVat ? Object.keys(t.vatByRate).sort((a, b) => a - b).map(rate =>
      `<tr><td>${L.vat} ${rate}% <span class="dim">${L.on} ${fmt(t.vatByRate[rate].base)}</span></td><td class="r num">${fmt(t.vatByRate[rate].vat)}</td></tr>`).join('')
      : `<tr><td>${L.vat}</td><td class="r num">${fmt(t.totalVAT)}</td></tr>`;

    const contact = [company.phone, company.email, company.website].filter(Boolean).map(escapeHtml).join('<br>');
    const clientContact = [cl.contact ? escapeHtml(cl.contact) : '', cl.matricule ? L.mfCin + ' ' + escapeHtml(matriculeLisible(cl.matricule)) : '', cl.phone ? escapeHtml(cl.phone) : '', cl.email ? escapeHtml(cl.email) : ''].filter(Boolean).join('<br>');
    // Pied de page légal : le texte libre s'il est rempli, sinon composé du nom et du matricule
    const footerBase = company.footer || [company.name, company.matricule ? (lang === 'en' ? 'Tax ID ' : 'Matricule fiscal ') + matriculeLisible(company.matricule) : ''].filter(Boolean).join(' — ');
    const legal = [footerBase, company.rc ? 'RC ' + company.rc : '', company.capital ? (lang === 'en' ? 'Share capital ' : 'Capital ') + capitalAffiche(company.capital, company.currency, lang) : ''].filter(Boolean).join(' — ');
    const grandLabel = isInvoice || isProforma ? L.netToPay : isCredit ? L.creditAmount : L.totalTTC;
    const grandValue = isQuote || isOrder || isContract ? t.totalTTC : t.netToPay;
    const wordsIntro = isInvoice ? (estLiberal(company) ? L.wordsFees : L.wordsInvoice) : isCredit ? L.wordsCredit : isQuote ? L.wordsQuote : L.wordsDoc;
    // Un contrat porte un échéancier de prix, pas un montant à régler : la somme en toutes lettres n'y a pas sa place.
    const showWords = !isContract;
    const paymentTerms = lang === 'en' ? company.paymentTermsEn : company.paymentTerms;
    const quoteTerms = lang === 'en' ? company.quoteTermsEn : company.quoteTerms;

    return `<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="utf-8">
<title>${title} ${escapeHtml(numberText)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif; color: ${ink}; font-size: 9.5pt; line-height: 1.42; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; min-height: 296mm; padding: 0 0 12mm; position: relative; background: #fff; overflow: hidden; }
  /* une page par feuille : c'est paginate qui les fabrique, le navigateur ne coupe plus rien lui-même */
  .page + .page { break-before: page; page-break-before: always; }
  ${opts.preview ? 'html { zoom: ' + (opts.zoom || 0.5) + '; background: #e9edf1; } body { padding: 8mm 0; } .page { box-shadow: 0 4px 24px rgba(20,40,60,.12); margin: 0 auto; border-radius: 2mm; } .page + .page { margin-top: 8mm; }' : ''}

  .num { font-variant-numeric: tabular-nums; }
  .mono { font-family: "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; font-size: 9pt; letter-spacing: .4px; }
  .dim { color: #8b95a3; }
  .strong { font-weight: 600; }
  .r { text-align: right; white-space: nowrap; }
  .k { font-size: 7pt; text-transform: uppercase; letter-spacing: 1.6px; color: ${accent}; font-weight: 700; }

  /* bandeau clair */
  .hero { background: linear-gradient(135deg, ${tint(.14)} 0%, ${tint(.05)} 60%, #fff 100%); padding: 10mm 18mm 8mm; position: relative; }
  .hero::after { content: ""; position: absolute; right: -30mm; top: -30mm; width: 90mm; height: 90mm; border-radius: 50%; background: ${tint(.08)}; }
  .hero > * { position: relative; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  .brand .logo { max-height: 16mm; max-width: 52mm; display: block; margin-bottom: 2.5mm; }
  .brand .name { font-size: 12.5pt; font-weight: 700; letter-spacing: -.1px; }
  .brand .tag { font-size: 8.5pt; color: #6b7684; margin-top: .5mm; }
  .brand .addr { font-size: 8.5pt; color: #6b7684; margin-top: 2mm; line-height: 1.35; }
  .title { text-align: right; }
  .title .kind { font-size: 30pt; font-weight: 200; letter-spacing: -1px; line-height: 1; color: ${ink}; }
  .title .number { display: inline-block; margin-top: 3mm; background: #fff; color: ${accent}; font-weight: 700; font-size: 9.5pt; letter-spacing: .5px; padding: 1.6mm 3.5mm; border-radius: 99px; box-shadow: 0 1px 4px rgba(20,40,60,.08); }
  .chips { display: flex; gap: 3mm; margin-top: 5mm; flex-wrap: wrap; }
  .chip { background: #fff; border-radius: 3mm; padding: 2mm 3.5mm; box-shadow: 0 1px 4px rgba(20,40,60,.06); }
  .chip .ck { display: block; font-size: 7pt; color: #8b95a3; text-transform: uppercase; letter-spacing: 1.2px; font-weight: 600; }
  .chip .cv { display: block; font-size: 10pt; font-weight: 600; margin-top: .4mm; }
  .chip .cs { display: block; font-size: 7.5pt; font-weight: 700; margin-top: .6mm; color: ${accent}; }

  .inner { padding: 5mm 18mm 0; }

  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; }
  .party { padding-left: 4mm; border-left: .7mm solid ${tint(.55)}; }
  .party .k { margin-bottom: 1.5mm; display: block; }
  .party .pname { font-size: 11pt; font-weight: 700; margin-bottom: .8mm; }
  .party .addr { color: #4b5563; }
  .party .more { color: #8b95a3; font-size: 9pt; margin-top: 1mm; }

  table.lines { width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 4mm; }
  table.lines thead th { font-size: 7pt; text-transform: uppercase; letter-spacing: 1.5px; color: #6b7684; font-weight: 700; text-align: left; padding: 2.4mm 3mm; background: ${tint(.09)}; }
  table.lines thead th:first-child { border-radius: 2.5mm 0 0 2.5mm; }
  table.lines thead th:last-child { border-radius: 0 2.5mm 2.5mm 0; }
  table.lines thead th.r { text-align: right; }
  table.lines tbody td { padding: 2mm 3mm; border-bottom: .2mm solid #eceff3; vertical-align: top; }
  table.lines tbody tr:last-child td { border-bottom: none; }
  table.lines .lbl { font-weight: 600; }
  table.lines tr.titre td { background: ${tint(0.07)}; padding-top: 5px; padding-bottom: 5px; }
  table.lines tr.titre .lbl { font-weight: 700; text-transform: uppercase; letter-spacing: .04em; font-size: 8.5pt; }
  table.lines .desc { font-size: 8.8pt; color: #6b7684; margin-top: .6mm; line-height: 1.4; }
  table.lines .unit { color: #9aa3ae; font-size: 8.5pt; }

  .after { display: grid; grid-template-columns: ${noPrices ? '1fr' : '1fr 74mm'}; gap: 12mm; margin-top: 3mm; align-items: start; }
  .card { background: ${tint(.07)}; border-radius: 3.5mm; padding: 4mm 5mm; }
  table.totals { width: 100%; border-collapse: collapse; font-size: 9.4pt; }
  table.totals td { padding: .7mm 0; color: #4b5563; }
  table.totals td.r { color: ${ink}; }
  table.totals tr.sub td { border-top: .2mm solid ${tint(.35)}; padding-top: 1.6mm; font-weight: 600; }
  .grand { margin-top: 2mm; padding-top: 2.5mm; border-top: .3mm solid ${tint(.45)}; display: flex; justify-content: space-between; align-items: baseline; }
  .grand .gl { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.4px; color: ${accent}; }
  .grand .gv { font-size: 17pt; font-weight: 700; letter-spacing: -.4px; }
  .grand .gv small { font-size: 8.5pt; color: ${accent}; margin-left: 1.2mm; letter-spacing: .8px; font-weight: 700; }
  .words { margin-top: 2.5mm; font-size: 8.2pt; color: #6b7684; line-height: 1.45; }
  .words strong { color: ${ink}; font-weight: 600; }

  .info { font-size: 9pt; color: #4b5563; }
  .info .k { margin-bottom: 1.5mm; display: block; }
  .info .row { display: flex; gap: 4mm; padding: .6mm 0; }
  .info .row span:first-child { color: #8b95a3; min-width: 16mm; }
  .info .terms { margin-top: 1.2mm; color: #6b7684; }
  .info + .info, .notes { margin-top: 5mm; }
  /* Les notes sont découpées ligne par ligne : c'est ce qui permet à paginate de les répartir sur
     plusieurs pages quand elles sont longues, au lieu de renoncer à toute la mise en page. */
  .notes { font-size: 9pt; color: #4b5563; line-height: 1.45; }
  .notes .n-l { min-height: 1.45em; white-space: pre-line; }

  .sign { display: flex; justify-content: ${isQuote || isOrder || isDelivery || isContract ? 'space-between' : 'flex-end'}; gap: 12mm; margin-top: 5mm; }
  /* clauses d'un contrat : de la lecture, pas un tableau — deux colonnes tiennent l'A4 sans rétrécir le texte */
  .clauses { column-count: 2; column-gap: 10mm; margin-top: 5mm; font-size: 8.5pt; color: #4b5563; line-height: 1.45; }
  .clauses .cl { break-inside: avoid; page-break-inside: avoid; margin-bottom: 3.5mm; }
  .clauses .cl-t { font-weight: 700; color: ${ink}; margin-bottom: .6mm; }
  .sign .s { width: 64mm; height: 15mm; border: .3mm dashed ${tint(.5)}; border-radius: 3.5mm; padding: 3mm 4mm; position: relative; }
  .sign .s small { display: block; color: #9aa3ae; font-size: 8pt; margin-top: .6mm; }
  .sign .s img { position: absolute; right: 3mm; top: 1.5mm; max-height: 12mm; max-width: 34mm; }

  /* (plateforme) Le tampon comme une encre (lot facture, 05/10/2026) : pâle, en travers du milieu de la page, il se
     multiplie avec ce qu'il couvre — un texte noir reste noir, le blanc prend sa couleur. Rien ne passe dessous. */
  .page { isolation: isolate; }
  .stamp { position: absolute; left: 50%; top: 150mm; transform: translate(-50%, -50%) rotate(-24deg); border: 1.4mm solid ${accent}; color: ${accent}; border-radius: 4mm; padding: 2mm 9mm; font-size: 52pt; font-weight: 800; letter-spacing: 3mm; text-transform: uppercase; white-space: nowrap; opacity: .16; mix-blend-mode: multiply; pointer-events: none; z-index: 2; }
  .stamp.draft { border-color: #6b7684; color: #6b7684; }

  .footer { position: absolute; left: 18mm; right: 18mm; bottom: 7mm; font-size: 7.6pt; color: #9aa3ae; display: flex; justify-content: space-between; gap: 6mm; border-top: .2mm solid #eceff3; padding-top: 2.5mm; }
  .footer .f-left { white-space: pre-line; }
  .footer .f-right { white-space: nowrap; text-align: right; }

  /* Pages suivantes : pas de bandeau d'en-tête (il appartient à la première), mais de quoi savoir de
     quel document et de quel client il s'agit si la feuille est lue seule. */
  .page.suite .inner { padding-top: 12mm; }
  .cont { display: flex; justify-content: space-between; align-items: baseline; gap: 6mm; padding-bottom: 2.5mm; margin-bottom: 4mm; border-bottom: .2mm solid #eceff3; }
  .cont .c-doc { font-size: 9.5pt; font-weight: 700; color: ${ink}; }
  .cont .c-cl { font-size: 8.5pt; color: #8b95a3; text-align: right; }

  /* documents longs : pas de ligne coupée entre deux pages, en-tête du tableau répété */
  table.lines thead { display: table-header-group; }
  table.lines tr, .after, .sign, .card, .parties { break-inside: avoid; page-break-inside: avoid; }

  /* mode compact (fitToPage) : marges resserrées quand le contenu dépasse d'un peu la page, même design */
  .page.compact .hero { padding: 8mm 18mm 6mm; }
  .page.compact .chips { margin-top: 4mm; }
  .page.compact .inner { padding-top: 4mm; }
  .page.compact .parties { gap: 10mm; }
  .page.compact .party .pname { margin-bottom: .4mm; }
  .page.compact table.lines { margin-top: 3mm; }
  .page.compact table.lines tbody td { padding: 1.4mm 3mm; }
  .page.compact .after { margin-top: 2mm; }
  .page.compact .card { padding: 3mm 5mm; }
  .page.compact .info + .info, .page.compact .notes { margin-top: 3mm; }
  .page.compact .words { margin-top: 1.8mm; }
  .page.compact .clauses { margin-top: 3.5mm; font-size: 8pt; }
  .page.compact .clauses .cl { margin-bottom: 2.6mm; }
  /* Un contrat porte un tableau de prix ET sept clauses ET deux cases de signature : quand il ne tient pas,
     on resserre les clauses d'un cran de plus plutôt que de déborder de quelques millimètres sur une page
     presque vide. Au-delà, il fait légitimement deux pages — un contrat de deux pages n'a rien d'anormal. */
  .page.compact.t-contrat .clauses { font-size: 7.6pt; column-gap: 8mm; line-height: 1.38; }
  .page.compact.t-contrat .clauses .cl { margin-bottom: 2.2mm; }
  .page.compact.t-contrat .card { padding: 3mm 4mm; }
  .page.compact.t-contrat .notes { margin-top: 2mm; }
  .page.compact .sign { margin-top: 3.5mm; }
  .page.compact .sign .s { height: 13mm; }
  /* Seul le contrat a une légende longue (« Lu et approuvé, date et signature ») : sa case grandit pour
     ne pas déborder sur le pied de page. Les autres gardent une hauteur fixe, qui ne coûte rien en place. */
  .page.t-contrat .sign .s { height: auto; min-height: 15mm; }
  .page.compact.t-contrat .sign .s { height: auto; min-height: 13mm; }

  /* Second cran (dense) : il ne sert QUE s'il fait gagner une page entière — c'est paginate qui en
     décide. Resserrer un document qui fera deux pages de toute façon ne gagne rien et se lit moins bien. */
  .page.dense .hero { padding: 6mm 18mm 5mm; }
  .page.dense .brand .addr { line-height: 1.25; margin-top: 1.4mm; }
  .page.dense .chips { margin-top: 3mm; gap: 2.5mm; }
  .page.dense .chip { padding: 1.5mm 3mm; }
  .page.dense .inner { padding-top: 3mm; }
  .page.dense .parties { gap: 8mm; }
  .page.dense .party .addr, .page.dense .party .more { line-height: 1.3; }
  .page.dense table.lines { margin-top: 2.5mm; }
  .page.dense table.lines thead th { padding: 1.8mm 3mm; }
  .page.dense table.lines tbody td { padding: 1.1mm 3mm; }
  .page.dense table.lines .desc { font-size: 8.2pt; line-height: 1.3; margin-top: .3mm; }
  .page.dense .after { margin-top: 1.5mm; }
  .page.dense .card { padding: 2.5mm 4mm; }
  .page.dense .words { margin-top: 1.4mm; }
  .page.dense .info + .info, .page.dense .notes { margin-top: 2.4mm; }
  .page.dense .sign { margin-top: 2.5mm; }
  .page.dense .sign .s { height: 11mm; }
  .page.dense.t-contrat .sign .s { height: auto; min-height: 11mm; }
</style></head>
<body><div class="page t-${escapeHtml(doc.type || 'devis')}">
  ${stampText ? `<div class="stamp${stampKey === 'draft' ? ' draft' : ''}">${escapeHtml(stampText)}</div>` : ''}
  <div class="hero">
    <div class="head">
      <div class="brand">
        ${company.logo ? `<img class="logo" src="${company.logo}" alt="">` : ''}
        <div class="name">${escapeHtml(company.name)}</div>
        ${company.tagline ? `<div class="tag">${escapeHtml(company.tagline)}</div>` : ''}
        <div class="addr">${[company.address ? nl2br(company.address) : '', String(company.matricule || '').trim() ? `${L.mf} ${escapeHtml(matriculeLisible(company.matricule))}` : '', contact].filter(Boolean).join('<br>')}</div>
      </div>
      <div class="title">
        <div class="kind">${title}</div>
        <div class="number">${escapeHtml(numberText)}</div>
      </div>
    </div>
    <div class="chips">${meta}</div>
  </div>

  <div class="inner">
    <div class="parties">
      <div class="party">
        <span class="k">${isSupplierOrder ? L.supplier : isInvoice || isProforma ? L.billedTo : isCredit || isDelivery || isContract ? L.client : L.preparedFor}</span>
        <div class="pname">${escapeHtml(cl.name || '')}</div>
        ${cl.address ? `<div class="addr">${nl2br(cl.address)}</div>` : ''}
        ${clientContact ? `<div class="more">${clientContact}</div>` : ''}
      </div>
      ${doc.subject ? `<div class="party"><span class="k">${L.subject}</span><div class="pname" style="font-weight:600;font-size:10.5pt">${escapeHtml(doc.subject)}</div></div>` : ''}
    </div>

    <table class="lines">
      <thead><tr>
        <th>${L.designation}</th>
        <th class="r" style="width:16mm">${L.qty}</th>
        ${noPrices ? '' : `<th class="r" style="width:26mm">${L.unitPrice}</th>
        ${remiseLigne ? `<th class="r" style="width:14mm">${L.lineDiscount}</th>` : ''}
        ${showVat ? `<th class="r" style="width:12mm">${L.vat}</th>` : ''}<th class="r" style="width:28mm">${L.lineTotal}</th>`}
      </tr></thead>
      <tbody>${linesHtml}</tbody>
    </table>

    <div class="after">
      <div>
        ${isInvoice && (company.rib || company.bank || paymentTerms) ? `
        <div class="info"><span class="k">${L.payment}</span>
          ${company.bank ? `<div class="row"><span>${L.bank}</span><span>${escapeHtml(company.bank)}</span></div>` : ''}
          ${company.rib ? `<div class="row"><span>${L.rib}</span><span class="mono">${escapeHtml(company.rib)}</span></div>` : ''}
          ${doc.number ? `<div class="row"><span>${L.motif}</span><span>${escapeHtml(doc.number)}</span></div>` : ''}
          ${paymentTerms ? `<div class="terms">${nl2br(paymentTerms)}</div>` : ''}
        </div>` : ''}
        ${exoRS ? `<div class="info"><span class="k">${L.withholding}</span><div class="terms">${L.exoRS(escapeHtml(exoRS.numero || ''), fmtDate(exoRS.au))}</div></div>` : ''}
        ${doc.ttn && doc.ttn.reference ? `<div class="info ttn"><span class="k">${lang === 'en' ? 'E-invoice' : 'Facture électronique'}</span><div style="display:flex;gap:3mm;align-items:center;margin-top:1mm">${doc.ttn.qr && typeof api.qrImage === 'function' ? api.qrImage(doc.ttn.qr) : ''}<div class="terms">${lang === 'en' ? 'Validated by TTN (El Fatoora)' : 'Validée par la TTN (El Fatoora)'}<br>${lang === 'en' ? 'Reference' : 'Référence'} <b>${escapeHtml(doc.ttn.reference)}</b></div></div></div>` : ''}
        ${isCredit ? `
        <div class="info"><span class="k">${L.avoir}</span>
          ${doc.creditOfNumber ? L.creditText(escapeHtml(doc.creditOfNumber), estLiberal(company) ? (lang === 'en' ? 'fee note' : 'la note d\'honoraires') : '') : L.creditFreeText}${doc.creditReason ? ' — ' + escapeHtml(doc.creditReason) : ''}.
        </div>` : ''}
        ${isQuote ? `
        <div class="info"><span class="k">${L.conditions}</span>
          ${L.validText(fmtDate(doc.dueDate))} ${escapeHtml(quoteTerms || '')}
        </div>` : ''}
        ${isProforma ? `
        <div class="info"><span class="k">${L.proforma}</span><div class="terms">${L.proformaNote}</div></div>
        ${company.rib || company.bank ? `<div class="info"><span class="k">${L.payment}</span>
          ${company.bank ? `<div class="row"><span>${L.bank}</span><span>${escapeHtml(company.bank)}</span></div>` : ''}
          ${company.rib ? `<div class="row"><span>${L.rib}</span><span class="mono">${escapeHtml(company.rib)}</span></div>` : ''}
        </div>` : ''}` : ''}
        ${isOrder ? `<div class="info"><span class="k">${L.commande}</span><div class="terms">${L.orderNote}</div></div>` : ''}
        ${isDelivery ? `<div class="info"><span class="k">${L.livraison}</span><div class="terms">${L.deliveryNote}</div></div>` : ''}
        ${isSupplierOrder ? `<div class="info"><span class="k">${isDemandePrix ? L.demandePrix : L.commandeFournisseur}</span><div class="terms">${isDemandePrix ? L.demandePrixNote : L.supplierOrderNote}</div></div>` : ''}
        ${doc.notes ? `<div class="notes">${String(doc.notes).split('\n').map(l => `<div class="n-l">${escapeHtml(l)}</div>`).join('')}</div>` : ''}
      </div>
      ${noPrices ? '' : `<div class="card">
        <table class="totals">
          <tr><td>${L.subtotal}</td><td class="r num">${fmt(t.totalHT)}</td></tr>
          ${t.discount ? `<tr><td>${L.discount} ${pct(t.discountRate)}%</td><td class="r num">− ${fmt(t.discount)}</td></tr><tr><td>${L.netHT}</td><td class="r num">${fmt(t.netHT)}</td></tr>` : ''}
          ${t.fodec ? `<tr><td>FODEC ${pct(Number(doc.fodecRate) || 0)}%</td><td class="r num">${fmt(t.fodec)}</td></tr>` : ''}
          ${vatRows}
          ${t.stamp ? `<tr><td>${L.stamp}</td><td class="r num">${fmt(t.stamp)}</td></tr>` : ''}
          ${t.withholding ? `<tr class="sub"><td>${L.totalTTC}</td><td class="r num">${fmt(t.totalTTC)}</td></tr><tr><td>${L.withholding} ${pct(t.withholdingRate)}%</td><td class="r num">− ${fmt(t.withholding)}</td></tr>` : ''}
        </table>
        <div class="grand"><span class="gl">${grandLabel}</span><span class="gv num">${fmt(grandValue)}<small>${escapeHtml(cur)}</small></span></div>
        ${showWords ? `<div class="words">${wordsIntro} <strong>${escapeHtml(amountToWords(grandValue, cur, lang).toLowerCase())}</strong>.</div>` : ''}
      </div>`}
    </div>

    ${isContract ? `<div class="clauses">
      ${CLAUSE_LABELS.filter(([k]) => (clauses[k] || '').trim()).map(([k, label], i) =>
        `<div class="cl"><div class="cl-t">${i + 1}. ${escapeHtml(label)}</div><div class="cl-b">${nl2br(clauses[k])}</div></div>`).join('')}
    </div>` : ''}

    <div class="sign">
      ${isQuote ? `<div class="s"><span class="k">${L.approve}</span><small>${L.approveSub}</small></div>` : ''}
      ${isOrder ? `<div class="s"><span class="k">${L.orderApprove}</span><small>${L.approveSub}</small></div>` : ''}
      ${isDelivery ? `<div class="s"><span class="k">${L.received}</span><small>${L.receivedSub}</small></div>` : ''}
      ${isContract ? `<div class="s"><span class="k">${L.contractClient}</span><small>${escapeHtml(cl.name || '')} — ${L.contractSub}</small></div>` : ''}
      <div class="s"><span class="k">${isQuote || isContract ? L.provider : L.stampSign}</span><small>${escapeHtml(company.name)}</small>${company.stampImage ? `<img src="${company.stampImage}" alt="">` : ''}</div>
    </div>
  </div>

  <div class="footer">
    <div class="f-left">${nl2br(legal)}</div>
    <div class="f-right">${title} ${escapeHtml(numberText)}</div>
  </div>
</div></body></html>`;
  }

  // À exécuter dans le document rendu (aperçu, fenêtre PDF) : si le contenu déborde de la page A4, passe en
  // mode compact (marges resserrées, même design) pour qu'un document de quatre ou cinq lignes tienne sur
  // une page. Renvoie true si le mode compact a été appliqué. Au-delà, le document fait légitimement deux pages.
  function fitToPage(d) {
    const page = d && d.querySelector && d.querySelector('.page');
    if (!page || page.classList.contains('compact')) return false;
    const probe = d.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;top:0;left:0;width:1px;height:296mm';
    page.appendChild(probe);
    let overflow = page.offsetHeight > probe.offsetHeight + 1;
    probe.remove();
    // Le pied de page est positionné en absolu : le contenu peut le chevaucher sans allonger la page.
    if (!overflow) {
      const foot = d.querySelector('.footer'), last = d.querySelector('.sign') || d.querySelector('.after');
      if (foot && last) overflow = last.getBoundingClientRect().bottom > foot.getBoundingClientRect().top;
    }
    if (overflow) page.classList.add('compact');
    return overflow;
  }

  // Distribue le document sur de VRAIES pages A4 : une <div class="page"> par feuille, chacune avec son
  // pied de page numéroté et, à partir de la deuxième, un bandeau qui rappelle le document et le client.
  //
  // Avant la 7.31.0 on laissait le navigateur découper un seul long bloc. Le pied de page, posé en
  // absolu à la fin de ce bloc, s'imprimait alors PAR-DESSUS les cases de signature ; la première page
  // n'en portait aucun (donc aucune mention légale) ; et un devis de neuf lignes finissait sur une
  // seconde page vide aux trois quarts. Mesuré, pas déduit : chromium + page.pdf.
  //
  // À exécuter dans le document rendu (aperçu, fenêtre PDF). AUTONOME : main.js la sérialise pour
  // l'exécuter dans la fenêtre PDF, elle ne peut donc appeler aucune autre fonction de ce fichier.
  // Renvoie le nombre de pages. Au moindre pépin, le document d'origine est restauré et on rend la
  // main au navigateur : on ne perd jamais une ligne d'une facture.
  function paginate(d) {
    const body = d && d.body;
    const depart = d && d.querySelector && d.querySelector('.page');
    if (!body || !depart || !depart.querySelector('.inner') || !depart.querySelector('.footer')) return 1;
    if (body.getAttribute('data-sf-pages')) return Number(body.getAttribute('data-sf-pages')) || 1;
    const secours = body.innerHTML;

    const sonde = d.createElement('div');
    sonde.style.cssText = 'position:absolute;visibility:hidden;top:0;left:0;width:1px;height:100mm';
    body.appendChild(sonde);
    const MM = sonde.offsetHeight / 100;
    sonde.remove();
    if (!(MM > 0)) return 1;
    const HAUT = 296 * MM;

    // Répartit le contenu de la page donnée sur autant de pages qu'il faut. Renvoie la liste des
    // pages, ou null si l'une déborde malgré tout (auquel cas l'appelant restaure l'original).
    function repartir(page) {
      const inner = page.querySelector('.inner');
      const footer = page.querySelector('.footer');
      const hero = page.querySelector('.hero');
      const stamp = page.querySelector('.stamp');
      // La bande basse réservée sur CHAQUE page : le pied lui-même, plus l'air qui le sépare du contenu.
      const UTILE = HAUT - (footer.offsetHeight + 10 * MM);
      const pages = [];
      const coquille = page.cloneNode(false);
      const titre = footer.querySelector('.f-right');
      const nomClient = page.querySelector('.party .pname');

      const bandeau = () => {
        const b = d.createElement('div');
        b.className = 'cont';
        const a = d.createElement('div'); a.className = 'c-doc'; a.textContent = titre ? titre.textContent : '';
        const c = d.createElement('div'); c.className = 'c-cl'; c.textContent = nomClient ? nomClient.textContent : '';
        b.appendChild(a); b.appendChild(c);
        return b;
      };
      const nouvelle = suite => {
        const p = coquille.cloneNode(false);
        if (suite) p.classList.add('suite');
        const zone = d.createElement('div');
        zone.className = 'inner';
        if (suite) zone.appendChild(bandeau());
        p.appendChild(zone);
        page.parentNode.insertBefore(p, page);
        const o = { el: p, zone, base: zone.children.length };
        pages.push(o);
        return o;
      };
      const tient = c => c.zone.offsetTop + c.zone.offsetHeight <= UTILE;
      // Vrai si la page portait déjà quelque chose avant le dernier élément posé : sans ce garde-fou,
      // un bloc plus haut qu'une page entière fabriquerait des pages vides à l'infini.
      const seul = c => c.zone.children.length <= c.base + 1;

      let cur = nouvelle(false);
      if (stamp) cur.el.insertBefore(stamp, cur.zone);
      if (hero) cur.el.insertBefore(hero, cur.zone);

      // Un bloc insécable : il descend entier plutôt que d'être coupé.
      const poser = el => {
        cur.zone.appendChild(el);
        if (!tient(cur) && !seul(cur)) {
          cur = nouvelle(true);
          cur.zone.appendChild(el);
        }
      };
      // Un bloc qu'on peut répartir morceau par morceau (les lignes d'un tableau, les clauses d'un
      // contrat) : on remplit la page, puis on repart avec un conteneur identique — donc l'en-tête
      // des colonnes se retrouve en tête de chaque page, là où on le cherche.
      const repandre = (el, dedans) => {
        const hote = dedans ? el.querySelector(dedans) : el;
        const morceaux = Array.prototype.slice.call(hote.children);
        const modele = el.cloneNode(true);
        const creux = dedans ? modele.querySelector(dedans) : modele;
        while (creux.firstChild) creux.removeChild(creux.firstChild);
        let boite = modele.cloneNode(true);
        let creux2 = dedans ? boite.querySelector(dedans) : boite;
        const neuve = () => {
          cur = nouvelle(true);
          boite = modele.cloneNode(true);
          creux2 = dedans ? boite.querySelector(dedans) : boite;
          cur.zone.appendChild(boite);
        };
        cur.zone.appendChild(boite);
        if (!tient(cur) && !seul(cur)) { boite.remove(); neuve(); }
        for (let i = 0; i < morceaux.length; i++) {
          creux2.appendChild(morceaux[i]);
          if (tient(cur)) continue;
          // Un morceau plus haut qu'une page entière : on le laisse déborder, le filet de sortie
          // tranchera. Attention, la condition porte sur la PAGE et pas sur le conteneur : un premier
          // morceau posé dans un conteneur neuf, sur une page déjà remplie, doit descendre.
          if (creux2.children.length === 1 && seul(cur)) continue;
          creux2.removeChild(morceaux[i]);
          neuve();
          creux2.appendChild(morceaux[i]);
        }
      };

      // Le bloc de fin (conditions, notes, totaux) est insécable : de longues notes le rendent plus
      // haut qu'une page, et plus rien ne tient nulle part. On sort alors la colonne de gauche du
      // bloc — ses paragraphes se répartissent — et la carte des totaux reste à sa place, à droite.
      const fin = inner.querySelector('.after');
      if (fin && fin.offsetHeight > UTILE) {
        const gauche = fin.firstElementChild;
        if (gauche && !gauche.classList.contains('card')) {
          while (gauche.firstElementChild) inner.insertBefore(gauche.firstElementChild, fin);
          gauche.remove();
          if (!fin.children.length) fin.remove();
          else fin.insertBefore(d.createElement('div'), fin.firstChild);
        }
      }

      const blocs = Array.prototype.slice.call(inner.children);
      for (let i = 0; i < blocs.length; i++) {
        const b = blocs[i];
        if (b.tagName === 'TABLE' && b.classList.contains('lines')) repandre(b, 'tbody');
        else if (b.classList.contains('clauses') || b.classList.contains('notes')) repandre(b, null);
        else poser(b);
        if (pages.length > 200) return null;
      }
      page.remove();
      // Filet : `overflow: hidden` masquerait un débordement au lieu de le montrer. Si une page
      // déborde malgré tout, on ne livre pas cette mise en page — mieux vaut le défaut d'hier qu'une
      // ligne invisible sur une facture.
      for (let i = 0; i < pages.length; i++) {
        if (pages[i].zone.offsetTop + pages[i].zone.offsetHeight > HAUT) return null;
      }
      // Le pied revient sur chaque page, numéroté. Il est posé en absolu : l'ajouter maintenant ne
      // change aucune mesure.
      for (let i = 0; i < pages.length; i++) {
        const f = footer.cloneNode(true);
        const droite = f.querySelector('.f-right');
        if (droite && pages.length > 1) droite.textContent = droite.textContent + ' — page ' + (i + 1) + ' sur ' + pages.length;
        pages[i].el.appendChild(f);
      }
      return pages;
    }

    const essai = classes => {
      body.innerHTML = secours;
      const p = d.querySelector('.page');
      p.classList.remove('compact', 'dense');
      for (let i = 0; i < classes.length; i++) p.classList.add(classes[i]);
      return repartir(p);
    };

    // On rend la main au navigateur : il découpe moins bien, mais il ne perd jamais rien. On renvoie
    // le nombre de pages qu'il fera, pour que l'aperçu n'annonce pas « 1 page » sur un document long.
    const abandon = () => {
      body.innerHTML = secours;
      const p = d.querySelector('.page');
      return p ? Math.max(1, Math.ceil((p.offsetHeight - 2) / (297 * MM))) : 1;
    };

    try {
      // On applique le resserrement le plus LÉGER qui fasse gagner une page. Resserrer un document qui
      // fera deux pages de toute façon ne gagne rien et se lit moins bien (défaut de fitToPage seul).
      const niveaux = [[], ['compact'], ['compact', 'dense']];
      let meilleur = null;
      for (let i = 0; i < niveaux.length; i++) {
        const r = essai(niveaux[i]);
        if (!r) return abandon();
        if (!meilleur || r.length < meilleur.n) meilleur = { classes: niveaux[i], n: r.length };
        if (meilleur.n === 1) break;
      }
      const final = essai(meilleur.classes);
      if (!final) return abandon();
      body.setAttribute('data-sf-pages', String(final.length));
      return final.length;
    } catch (_) {
      return abandon();
    }
  }

  // Nombre de pages A4 qu'occupera le document rendu (à exécuter dans le document, après paginate).
  function pageCount(d) {
    if (d && d.querySelectorAll) {
      const toutes = d.querySelectorAll('.page');
      if (toutes.length > 1) return toutes.length;
    }
    const page = d && d.querySelector && d.querySelector('.page');
    if (!page) return 1;
    const probe = d.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;top:0;left:0;width:1px;height:297mm';
    page.appendChild(probe);
    const n = Math.max(1, Math.ceil((page.offsetHeight - 2) / probe.offsetHeight));
    probe.remove();
    return n;
  }

  // ---------- unités de facturation ----------
  // Liste proposée dans les lignes de document et dans le catalogue. Elle couvre les métiers
  // courants ; une unité inhabituelle se saisit avec « Autre… » et rejoint ensuite la liste,
  // puisqu'on relit les unités déjà employées dans les données.
  const LINE_UNITS = [
    ['u', 'unité (u)'], ['h', 'heure (h)'], ['j', 'jour (j)'], ['demi-journée', 'demi-journée'],
    ['mois', 'mois'], ['an', 'année'], ['forfait', 'forfait'], ['intervention', 'intervention'],
    ['licence', 'licence'], ['abonnement', 'abonnement'], ['poste', 'poste'], ['lot', 'lot'],
    ['ml', 'mètre linéaire (ml)'], ['m²', 'mètre carré (m²)'], ['m³', 'mètre cube (m³)'],
    ['kg', 'kilogramme (kg)'], ['L', 'litre (L)'], ['km', 'kilomètre (km)'], ['page', 'page']
  ];
  // Unités déjà employées dans les documents et le catalogue, hors liste standard : elles restent
  // proposées d'une fois sur l'autre sans rien avoir à régler dans les paramètres.
  // Une quantité et son unité, accordées : « 29 postes », « 1 poste », « 3 kg », « 2 mois ». Une
  // abréviation (u, h, j, kg, m², ml, L…) ne prend jamais de « s » ; un mot déjà terminé par s, x ou z
  // non plus. Seul le nombre qui dépasse 1 (en valeur absolue) met le mot au pluriel, comme en français.
  function uniteAccordee(n, unite) {
    const u = String(unite == null ? '' : unite).trim();
    if (!u) return '';
    // Les abréviations de la liste sont celles dont le libellé porte la forme longue entre parenthèses.
    const abrev = LINE_UNITS.some(([code, lib]) => code === u && /\(/.test(lib));
    const connue = LINE_UNITS.some(([code]) => code === u);
    const mot = !abrev && (connue ? /^[a-zà-ÿ-]+$/.test(u) : /^[a-zà-ÿ][a-zà-ÿ-]{2,}$/.test(u)) && !/[sxz]$/.test(u);
    if (!mot || Math.abs(Number(n) || 0) < 2) return u;
    return u.split('-').map(p => /^(demi|mi|semi)$/.test(p) ? p : p + 's').join('-');
  }
  function usedUnits(data, extra) {
    const known = new Set(LINE_UNITS.map(u => u[0]));
    const out = [];
    const add = u => { u = (u || '').trim(); if (u && !known.has(u)) { known.add(u); out.push(u); } };
    (data && data.catalog || []).forEach(c => add(c.unit));
    (data && data.documents || []).forEach(d => (d.lines || []).forEach(l => add(l.unit)));
    (extra || []).forEach(add);
    return out.sort((a, b) => a.localeCompare(b, 'fr'));
  }

  // Taux de retenue à la source déjà employés et absents de la liste standard. Même principe que
  // `usedUnits` : un taux saisi une fois reste proposé partout ensuite, sans rien avoir à régler.
  // Sans ça, un taux libre saisi sur une facture disparaîtrait du menu de la suivante, et la fiche
  // du client le remettrait en silence à « par défaut » — c'est-à-dire changerait le montant.
  function usedWithholdingRates(data, extra) {
    const known = new Set(WITHHOLDING_RATES);
    const out = [];
    const add = r => {
      if (r === '' || r === null || r === undefined) return;
      const n = Number(r);
      if (!isFinite(n) || n <= 0 || known.has(n)) return;
      known.add(n); out.push(n);
    };
    const d = data || {};
    (d.documents || []).forEach(x => add(x.withholdingRate));
    (d.clients || []).forEach(x => add(x.withholdingRate));
    (d.suppliers || []).forEach(x => add(x.withholdingRate));
    (d.purchases || []).forEach(x => add(x.withholdingRate));
    (d.recurring || []).forEach(x => add(x.withholdingRate));
    add(d.company && d.company.defaultWithholdingRate);
    (extra || []).forEach(add);
    return out.sort((a, b) => a - b);
  }

  // ---------- dates saisies à la main ----------
  const pad2 = n => String(n).padStart(2, '0');
  function isRealDate(y, m, d) {
    if (!(y >= 1900 && y <= 2999) || !(m >= 1 && m <= 12) || !(d >= 1)) return false;
    return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function fmtDateInput(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }
  // Comprend ce que l'utilisateur tape : 12/03/2026, 12-3-26, 12032026, 12/03 (année en cours),
  // 12 (mois en cours), ou une date ISO collée. Renvoie '' si la date n'existe pas (31/02).
  // Le confort de frappe d'un champ date (10.15.0) : les barres s'écrivent toutes seules sur une suite
  // de chiffres (« 12032026 » → 12/03/2026), et celles qu'on TAPE se respectent. L'ancien masque
  // jetait les barres tapées et redécoupait les chiffres deux par deux : « 1/1/2026 », la façon la
  // plus naturelle d'écrire le premier janvier, devenait « 11/20/26 », puis « Date incomprise ». Vu à
  // la souris en saisissant une attestation ; un parcours qui pose la valeur ne passe jamais ici.
  // Rien d'autre que des chiffres et des barres : on ne touche pas (le départ du champ jugera).
  function masqueDate(v) {
    const txt = String(v == null ? '' : v);
    if (/[^\d/]/.test(txt)) return txt;
    const morceaux = txt.split('/');
    const segs = [];
    let cur = '';
    morceaux.forEach((m, i) => {
      for (const c of m) {
        if (segs.length < 2 && cur.length === 2) { segs.push(cur); cur = ''; }
        cur += c;
      }
      // Une barre tapée ferme le jour ou le mois en cours, même d'un seul chiffre.
      if (i < morceaux.length - 1 && segs.length < 2) { segs.push(cur); cur = ''; }
    });
    if (segs.length === 2) cur = cur.slice(0, 4);
    return segs.concat([cur]).join('/');
  }
  function parseDateInput(text, todayIso) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return '';
    const ref = todayIso || today();   // date de référence pour les saisies partielles
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (iso) {
      const y = +iso[1], m = +iso[2], d = +iso[3];
      return isRealDate(y, m, d) ? `${y}-${pad2(m)}-${pad2(d)}` : '';
    }
    const digits = s.replace(/\D/g, '');
    let d, m, y;
    const parts = s.split(/[^\d]+/).filter(Boolean);
    if (parts.length >= 2) { d = +parts[0]; m = +parts[1]; y = parts.length > 2 ? +parts[2] : +ref.slice(0, 4); }
    else if (digits.length === 8) { d = +digits.slice(0, 2); m = +digits.slice(2, 4); y = +digits.slice(4); }
    else if (digits.length === 6) { d = +digits.slice(0, 2); m = +digits.slice(2, 4); y = 2000 + +digits.slice(4); }
    else if (digits.length === 4) { d = +digits.slice(0, 2); m = +digits.slice(2, 4); y = +ref.slice(0, 4); }
    else if (digits.length === 1 || digits.length === 2) { d = +digits; m = +ref.slice(5, 7); y = +ref.slice(0, 4); }
    else return '';
    if (y != null && y < 100) y += 2000;
    return isRealDate(y, m, d) ? `${y}-${pad2(m)}-${pad2(d)}` : '';
  }
  // Grille du mois pour le calendrier : six semaines de sept jours, lundi en tête.
  // Les jours débordant sur les mois voisins sont marqués `out` pour être affichés en gris.
  function monthMatrix(year, month) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const shift = (first.getUTCDay() + 6) % 7;          // lundi = 0
    const start = new Date(Date.UTC(year, month - 1, 1 - shift));
    const weeks = [];
    for (let w = 0; w < 6; w++) {
      const days = [];
      for (let i = 0; i < 7; i++) {
        const cur = new Date(start.getTime() + (w * 7 + i) * 86400000);
        const y = cur.getUTCFullYear(), m = cur.getUTCMonth() + 1, d = cur.getUTCDate();
        days.push({ iso: `${y}-${pad2(m)}-${pad2(d)}`, day: d, out: m !== month });
      }
      weeks.push(days);
    }
    return weeks;
  }

  // ---------- un client, un article : le modèle vierge (10.14.0) ----------
  // Un client ou un article naît en UN endroit : la fiche (`clientForm`, `catalogForm`), les
  // créations à la volée depuis une ligne (9.2.1) et l'import depuis un tableur partent du même
  // modèle. Écrit trois fois, un champ ajouté demain manquerait à l'un des trois.
  function clientVierge(extra) {
    return Object.assign({ id: uid(), name: '', contact: '', matricule: '', address: '', phone: '', email: '', notes: '', withholdingRate: '' }, extra || {});
  }
  // (plateforme) Un fournisseur : le modèle de sa fiche (`supplierForm`) et de l'import depuis un tableur.
  function fournisseurVierge(extra) {
    return Object.assign({ id: uid(), name: '', contact: '', matricule: '', address: '', phone: '', email: '', rib: '', bank: '', notes: '', paymentTermsDays: '', withholdingRate: '' }, extra || {});
  }
  function articleVierge(company, extra, jour) {
    return Object.assign({ id: uid(), label: '', description: '', code: '', unit: '', unitPrice: 0, unitCost: 0, vatRate: defaultVat(company),
      tracked: false, minStock: 0, location: '', initialQty: 0, initialCost: 0, initialDate: jour || today(),
      serialized: false, warrantyMonths: 0 }, extra || {});
  }

  // ---------- la caisse (10.15.0, H5 de l'étude Hesabi) ----------
  //
  // Vendre au comptoir : un article scanné ou cliqué, un panier, un paiement, un ticket de 80 mm.
  // Un ticket n'est PAS un nouveau type de pièce : c'est une facture (`type: 'facture'`) marquée
  // `ticket`, émise et réglée dans le même geste. C'est ce qui rend juste, sans une ligne de plus,
  // tout ce qui lit une vente : le journal des ventes, la TVA collectée, le chiffre d'affaires, les
  // statistiques, la sortie de stock au coût moyen, l'encaissement en caisse, les écritures et le
  // paquet du comptable. Un nouveau type aurait demandé de le nommer dans quatre-vingts lecteurs —
  // et le premier oublié aurait vendu sans déclarer (règle 10.2.0 : le sens d'une pièce se porte
  // dans ce que les lecteurs lisent déjà, jamais dans leur mémoire).
  //
  // Ce qui change : une SÉRIE à elle (TIC-AAAA-NNN) — un ticket ne consomme jamais un numéro de
  // facture, sinon la série légale des factures aurait des trous ; pas de client obligatoire (on
  // vend à un passant) ; pas de timbre par défaut (À VÉRIFIER : le droit de timbre porte sur les
  // factures, un réglage l'ajoute) ; jamais de retenue à la source ; et il ne se liste pas avec les
  // factures (cent tickets par jour noieraient la liste) — il vit dans la page Caisse.
  const CLIENT_COMPTOIR = 'Vente au comptoir';
  const MODES_CAISSE = [['especes', 'Espèces'], ['carte', 'Carte'], ['cheque', 'Chèque']];
  function estTicket(d) { return !!(d && d.type === 'facture' && d.ticket); }
  // (plateforme 1.314.0) La facture qui revend un bien de l'entreprise (née de sa fiche, `assetId`) et l'avoir qui la corrige :
  // leur prix n'est pas une vente du métier, c'est le produit d'une cession (775), hors du chiffre d'affaires du comptable.
  function estCession(d, data) {
    if (!d) return false;
    if (d.type === 'facture') return !!d.assetId;
    const f = d.type === 'avoir' && d.creditOf ? ((data && data.documents) || []).find(x => x.id === d.creditOf) : null;
    return !!(f && f.type === 'facture' && f.assetId);
  }
  // (1.313.0) Le retour d'un article de caisse : l'avoir d'un ticket. Il se nomme comme son ticket (« Vente au comptoir »
  // quand le ticket n'avait pas de client) : l'accueil, la liste des factures et le journal des ventes disaient « — ».
  function estRetourDeTicket(d, data) { return !!(d && d.type === 'avoir' && d.creditOf && estTicket(((data && data.documents) || []).find(x => x.id === d.creditOf))); }
  // La série d'une pièce décide de son numéro : un ticket a la sienne.
  function serieDe(d) { return estTicket(d) ? 'ticket' : (d || {}).type; }
  function titreDePiece(d, company, lang) { return estTicket(d) ? (lang === 'en' ? 'Receipt' : 'Ticket') : docLabel((d || {}).type, company, lang); }
  // Un code-barres se compare sans ses espaces et sans la casse : une douchette tape « 6191234567890 »,
  // une étiquette imprimée « 619 1234 567890 », et une référence maison « ref-12 » vaut « REF-12 ».
  function normCode(v) { return String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase(); }
  function articleParCode(data, code) {
    const k = normCode(code);
    if (!k) return null;
    return ((data || {}).catalog || []).find(c => normCode(c.code) === k) || null;
  }
  // Le compte où va chaque mode : les espèces dans la CAISSE, la carte et le chèque à la banque. Sans
  // compte de caisse, un paiement en espèces tomberait sur le compte par défaut — la banque — et le
  // solde de la Trésorerie ne retomberait jamais sur l'argent du tiroir. La page le dit, et propose
  // de créer la caisse avant la première vente.
  function comptesDeCaisse(data) {
    const acc = ((data || {}).accounts || []).filter(a => !a.archived);
    const caisse = acc.find(a => a.kind === 'caisse');
    const banque = acc.find(a => a.isDefault && a.kind !== 'caisse') || acc.find(a => a.kind !== 'caisse');
    return { especes: caisse ? caisse.id : null, banque: banque ? banque.id : null };
  }
  function compteDuMode(data, mode) {
    const c = comptesDeCaisse(data);
    // La carte et le chèque arrivent à la BANQUE, jamais dans le tiroir : sans compte bancaire, il
    // n'y a pas de compte, et l'encaissement le refuse (vu à la souris : un remboursement par carte
    // sortait de la caisse, et le tiroir annonçait 17,850 DT de moins que ce qu'il contenait).
    return mode === 'especes' ? c.especes : c.banque;
  }
  // Une ligne de panier tirée du catalogue : son prix HT et son taux, ramené à zéro sous un régime
  // qui ne facture pas de TVA (7.22.0).
  function ligneDePanier(item, company) {
    return { itemId: item.id, label: item.label || '', unit: item.unit || '', qty: 1,
      unitPrice: Number(item.unitPrice) || 0, vatRate: tauxPourRegime(company, Number(item.vatRate) || 0) };
  }
  // (1.317.0, la droguerie jouée) Le prix au comptoir est celui de la facture : la liste de prix du client choisi et le
  // palier de la quantité (`prixArticlePour`). Le plombier payait au comptoir 89 DT le pot que sa liste met à 78, et
  // 4,900 DT les douze boîtes de vis que le palier de 10 met à 4,200 pour tout le monde. Chaque ligne d'un article du
  // catalogue reprend ce prix, et d'où il vient (`prixSource`, `prixListe` : pour l'écran, le ticket ne les garde pas) ;
  // une ligne sans article (« Article divers ») garde le sien. Rend le panier, ses prix à jour.
  function prixDuPanier(data, panier, clientId, jour) {
    (panier || []).forEach(l => {
      const it = l && l.itemId ? ((data && data.catalog) || []).find(x => x.id === l.itemId) : null;
      if (!it) return;
      const p = prixArticlePour(data, it, clientId || '', jour || today(), l.qty);
      l.unitPrice = p.prix; l.prixSource = p.source === 'article' ? '' : p.source; l.prixListe = p.liste || '';
    });
    return panier;
  }
  // Un montant TAPÉ au comptoir : « 50,5 », « 50.5 », « 1 000 » — la virgule est la décimale de
  // l'utilisateur (H-3, 10.12.0). Vide vaut null (rien de reçu n'est pas zéro reçu) ; illisible, NaN,
  // pour que le refus le dise au lieu de compter zéro.
  function montantTape(v) {
    if (v == null) return null;
    return typeof v === 'number' ? v : Compta.nombreStrict(v);
  }
  // Le panier, calculé par `computeTotals` — la même fonction que la facture : un total annoncé au
  // comptoir et un total déclaré ne peuvent pas diverger (règle 6.8.1).
  // (plateforme, brique 125) La remise du ticket : un pourcentage tapé (« 10 », « 7,5 ») ; vide, aucune.
  const tauxRemise = v => (v === '' || v == null ? 0 : Number(String(v).replace(',', '.').trim()));
  // La remise en TTC, comme les lignes du ticket : les lignes, moins elle, font le total avant timbre. La même pour le
  // panier à l'écran et pour le ticket imprimé (deux écrans, un chiffre).
  const remiseTtc = t => round3(t.lines.reduce((s, l) => s + l.ttc, 0) - t.netHT - t.totalVAT);
  function totauxDuPanier(lignes, company, opts) {
    const o = opts || {};
    const co = company || {};
    const doc = { type: 'facture', ticket: true, prixTtc: true, lines: lignes || [], discountRate: tauxRemise(o.remise),
      applyStamp: !!co.caisseTimbre, stampFee: co.caisseTimbre ? (Number(co.stampFee) || 0) : 0, currency: co.currency };
    const t = computeTotals(doc, co);
    const recu = montantTape(o.recu);
    const rendu = recu == null || !isFinite(recu) ? null : round3(recu - t.netToPay);
    return { ...t, remiseTtc: remiseTtc(t), recu, rendu, manque: rendu != null && rendu < 0 ? round3(-rendu) : 0 };
  }
  // Ce qui empêche d'encaisser — la MÊME fonction pour le bouton éteint et pour le refus (9.4.5).
  const MOTIF_SANS_BANQUE = 'Aucun compte bancaire : la carte et le chèque arrivent sur ta banque, pas dans le tiroir. Crée ton compte bancaire, ou encaisse en espèces.';
  function motifEncaissement(data, company, lignes, opts) {
    const o = opts || {};
    const ls = (lignes || []).filter(l => (Number(l.qty) || 0) !== 0);
    if (!ls.length) return 'Le panier est vide : scanne ou choisis un article.';
    if (ls.some(l => !(Number(l.qty) > 0))) return 'Une quantité est négative : un retour se fait par un avoir, depuis la liste des tickets.';
    // Un article SANS PRIX partirait gratuitement : le stock sortirait, rien n'entrerait. C'est presque
    // toujours un prix oublié au catalogue (l'assistant en propose un sans prix), jamais un cadeau.
    const sansPrix = ls.find(l => !(Number(l.unitPrice) > 0));
    if (sansPrix) return `« ${String(sansPrix.label || 'Article').trim()} » n'a pas de prix : fixe-le au catalogue, puis rajoute-le.`;
    const r = tauxRemise(o.remise);
    if (!(r >= 0 && r <= 100)) return 'La remise est un pourcentage entre 0 et 100 : tape-la comme 10 ou 7,5.';
    const mode = o.mode || 'especes';
    if (!MODES_CAISSE.some(m => m[0] === mode)) return 'Choisis le mode de paiement.';
    if (mode === 'especes' && !comptesDeCaisse(data).especes) return 'Aucun compte de caisse : crée-le pour que les espèces aillent dans le tiroir, pas à la banque.';
    if (mode !== 'especes' && !comptesDeCaisse(data).banque) return MOTIF_SANS_BANQUE;
    if (mode === 'especes' && o.recu !== '' && o.recu != null) {
      const t = totauxDuPanier(ls, company, { recu: o.recu, remise: o.remise });
      if (!isFinite(t.recu)) return 'Le montant reçu n\'est pas un nombre : tape-le comme 50 ou 50,500.';
      if (t.manque > 0) return `Il manque ${money(t.manque, (company || {}).currency)} : le montant reçu est plus petit que le total.`;
    }
    return '';
  }
  // Le ticket, émis et réglé. Il PREND un numéro : l'appelant ne l'appelle qu'après ses garde-fous
  // (licence, clôture), comme `issue()` avant `nextNumber` (règle 6.0.0).
  function ticketDeCaisse(data, company, lignes, opts) {
    const o = opts || {};
    const co = company || {};
    const jour = o.date || today();
    const mode = o.mode || 'especes';
    const ls = (lignes || []).filter(l => (Number(l.qty) || 0) > 0).map(l => ({
      itemId: l.itemId || '', label: String(l.label || '').trim() || 'Article', unit: l.unit || '',
      qty: Number(l.qty) || 0, unitPrice: Number(l.unitPrice) || 0, vatRate: Number(l.vatRate) || 0 }));
    const t = totauxDuPanier(ls, co, { recu: o.recu, remise: o.remise });
    const maintenant = o.maintenant || Date.now();
    const doc = {
      id: uid(), type: 'facture', ticket: true, prixTtc: true, number: nextNumber(data, 'ticket', jour), date: jour, dueDate: jour,
      clientId: o.clientId || '', subject: '', reference: '', lines: ls, discountRate: tauxRemise(o.remise) || 0,
      applyStamp: !!co.caisseTimbre, stampFee: co.caisseTimbre ? (Number(co.stampFee) || 0) : 0,
      regimeTva: regimeOf(co).id, status: 'envoyée', notes: '', withholdingRate: 0,
      lang: 'fr', currency: co.currency, exchangeRate: '', createdAt: maintenant, issuedTs: maintenant,
      caisse: { mode, recu: t.recu, rendu: t.rendu },
      payments: [{ id: uid(), date: jour, amount: t.netToPay, method: mode, accountId: compteDuMode(data, mode) || '', reference: '', note: 'Encaissé en caisse' }]
    };
    return doc;
  }
  // Les tickets d'un jour, et ce que le tiroir doit contenir le soir : le bilan de fin de journée
  // (le « Z » des caisses enregistreuses). Un ticket remboursé par un avoir compte au jour du
  // remboursement : l'argent est sorti ce jour-là.
  function bilanCaisse(data, company, jour) {
    const j = jour || today();
    const docs = (data || {}).documents || [];
    const tickets = docs.filter(d => estTicket(d) && d.date === j && d.status !== 'brouillon');
    const parMode = {};
    MODES_CAISSE.forEach(m => { parMode[m[0]] = 0; });
    let total = 0, articles = 0, tva = 0;
    tickets.forEach(d => {
      const t = computeTotals(d, company);
      total += t.netToPay; tva += t.totalVAT;
      articles += (d.lines || []).reduce((s, l) => s + (Number(l.qty) || 0), 0);
    });
    // L'argent réellement encaissé ce jour, mode par mode — remboursements compris (montant négatif).
    let rembourse = 0;
    docs.filter(estTicket).forEach(d => (d.payments || []).forEach(p => {
      if (p.date !== j) return;
      const k = parMode[p.method] !== undefined ? p.method : 'especes';
      parMode[k] = round3(parMode[k] + (Number(p.amount) || 0));
      if (Number(p.amount) < 0) rembourse = round3(rembourse - Number(p.amount));
    }));
    // Ce que le tiroir doit contenir CE SOIR : le solde du compte de caisse au jour dit, par la même
    // fonction que la Trésorerie — fond de caisse, jours précédents, dépôts en banque compris. Les
    // seules espèces du jour ne disent pas ce qu'on doit compter en fermant.
    const caisseId = comptesDeCaisse(data).especes;
    const tiroir = caisseId ? accountBalance(data, company, caisseId, j).balance : null;
    // (plateforme) Les retours du jour : les avoirs émis ce jour-là sur des tickets (un retour compte au jour du retour,
    // comme l'argent rendu). Le bilan dit les ventes, ces retours, et le NET du jour.
    const idsTickets = new Set(docs.filter(estTicket).map(d => d.id));
    const avoirs = docs.filter(d => d.type === 'avoir' && d.date === j && d.status !== 'brouillon' && idsTickets.has(d.creditOf));
    let retoursTtc = 0, retoursTva = 0;
    avoirs.forEach(a => { const t = computeTotals(a, company); retoursTtc += t.netToPay; retoursTva += t.totalVAT; });
    return { jour: j, nombre: tickets.length, total: round3(total), tva: round3(tva), articles: round3(articles),
      parMode, rembourse, especes: parMode.especes, tiroir, tickets,
      retours: avoirs.length, retoursTtc: round3(retoursTtc), avoirs: avoirs.map(a => a.number || ''),
      net: round3(round3(total) - round3(retoursTtc)), tvaNette: round3(round3(tva) - round3(retoursTva)) };
  }
  // Ce qu'un ticket peut encore rendre, article par article : ce qui a été vendu, moins ce que ses
  // avoirs ont déjà repris. On ne rend pas deux fois le même stylo.
  function resteARendre(data, ticket) {
    const repris = {};
    ((data || {}).documents || []).filter(d => d.type === 'avoir' && d.creditOf === ticket.id && d.status !== 'brouillon')
      .forEach(a => (a.lines || []).forEach((l, i) => {
        const k = l.ligneTicket != null ? l.ligneTicket : i;
        repris[k] = round3((repris[k] || 0) + (Number(l.qty) || 0));
      }));
    return (ticket.lines || []).map((l, i) => ({ i, label: l.label, unit: l.unit || '', vendu: Number(l.qty) || 0,
      rendu: repris[i] || 0, reste: round3(Math.max(0, (Number(l.qty) || 0) - (repris[i] || 0))) }));
  }
  // Rendre un article au comptoir : un AVOIR sur le ticket (la série légale des avoirs), et l'argent
  // rendu comme un règlement NÉGATIF sur le ticket — la règle du trop-perçu (10.14.0) : le reste du
  // ticket revient à zéro, la caisse voit une sortie, et l'article revient au stock par l'avoir.
  // `qtes` : { indexDeLigne: quantité rendue }. Prend un numéro : garde-fous d'abord (règle 6.0.0).
  function remboursementDeTicket(data, company, ticket, qtes, opts) {
    const o = opts || {};
    const co = company || {};
    const jour = o.date || today();
    const mode = o.mode || 'especes';
    const reste = resteARendre(data, ticket);
    const lignes = [];
    reste.forEach(r => {
      const q = Math.min(r.reste, Math.max(0, Number((qtes || {})[r.i]) || 0));
      if (!(q > 0)) return;
      const l = ticket.lines[r.i];
      lignes.push({ itemId: l.itemId || '', label: l.label, unit: l.unit || '', qty: q, unitPrice: Number(l.unitPrice) || 0, vatRate: Number(l.vatRate) || 0, ligneTicket: r.i });
    });
    if (!lignes.length) return { ok: false, motif: 'Choisis au moins un article à rendre.' };
    // Le compte d'où sort l'argent rendu, AVANT de prendre le numéro de l'avoir (6.0.0) : sans lui,
    // un avoir numéroté partirait sans que l'argent sorte d'aucun compte.
    if (!compteDuMode(data, mode)) return { ok: false, motif: mode === 'especes' ? 'Aucun compte de caisse : crée la caisse, ou rends l\'argent par carte ou par chèque.' : MOTIF_SANS_BANQUE };
    const maintenant = o.maintenant || Date.now();
    const avoir = {
      id: uid(), type: 'avoir', number: nextNumber(data, 'avoir', jour), status: 'émis', date: jour, dueDate: '',
      clientId: ticket.clientId || '', subject: `Retour sur le ticket ${ticket.number}`, reference: '',
      creditOf: ticket.id, creditOfNumber: ticket.number, creditReason: String(o.motif || '').trim(),
      ...(ticket.prixTtc === true ? { prixTtc: true } : {}),
      lines: lignes, discountRate: Number(ticket.discountRate) || 0, applyStamp: false, stampFee: 0, regimeTva: ticket.regimeTva || regimeOf(co).id,
      notes: '', withholdingRate: 0, lang: 'fr', currency: ticket.currency || co.currency, exchangeRate: '',
      payments: [], createdAt: maintenant, issuedTs: maintenant
    };
    const montant = computeTotals(avoir, co).netToPay;
    const paiement = { id: uid(), date: jour, amount: -montant, method: mode, accountId: compteDuMode(data, mode), reference: avoir.number, note: `Rendu sur le ticket ${ticket.number}` };
    return { ok: true, avoir, paiement, montant };
  }
  // L'heure d'un ticket : l'instant de l'encaissement, dans l'heure LOCALE du comptoir (un instant se
  // lit dans le calendrier de l'utilisateur, règle 5.2.3).
  function heureDuTicket(d) {
    const ts = Number((d || {}).issuedTs) || 0;
    if (ts < 1e11) return '';
    const t = new Date(ts);
    return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  }
  // Le ticket imprimé : une bande de 80 mm (ou 58 mm) de papier thermique. Tout y est TTC — c'est ce
  // que lit un client au comptoir — et la TVA se détaille par taux au pied, comme la loi le veut
  // d'une pièce de vente (À VÉRIFIER : les mentions exigées d'un ticket de caisse).
  function ticketHtml(d, company, opts) {
    const o = opts || {};
    const co = company || {};
    const cur = d.currency || co.currency;
    const m = n => money(n, cur);
    const t = computeTotals(d, co);
    const largeur = Number(co.caisseLargeur) === 58 ? 58 : 80;
    const cl = (o.clientName || '').trim();
    const ca = d.caisse || {};
    const mode = (MODES_CAISSE.find(x => x[0] === ca.mode) || PAYMENT_METHODS.find(x => x[0] === ca.mode) || [null, ''])[1];
    const tva = Object.keys(t.vatByRate).map(Number).filter(r => t.vatByRate[r].base).sort((a, b) => a - b);
    const pied = String(co.caissePied || '').trim() || 'Merci de votre visite.';
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(d.number || 'Ticket')}</title><style>
      @page { size: ${largeur}mm auto; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; background: #fff; color: #000; }
      body { width: ${largeur}mm; padding: 4mm 3.5mm 6mm; font: 11px/1.35 "Helvetica Neue", Arial, sans-serif; }
      .c { text-align: center; }
      .co { font-weight: 700; font-size: 14px; }
      .muted { color: #333; }
      hr { border: 0; border-top: 1px dashed #000; margin: 2.5mm 0; }
      table { width: 100%; border-collapse: collapse; }
      td { vertical-align: top; padding: 0.4mm 0; }
      td.r { text-align: right; white-space: nowrap; padding-inline-start: 2mm; }
      .q { font-size: 10px; color: #333; }
      .tot td { font-size: 15px; font-weight: 700; padding-top: 1mm; }
      .exemple { border: 1px solid #000; text-align: center; font-weight: 700; margin-bottom: 2mm; padding: 1mm; }
    </style></head><body>
      ${o.exemple ? '<div class="exemple">EXEMPLE — pas un vrai ticket</div>' : ''}
      <div class="c co">${escapeHtml(co.name || '')}</div>
      <div class="c muted">${escapeHtml(co.address || '').replace(/\n/g, '<br>')}${co.phone ? '<br>Tél. ' + escapeHtml(co.phone) : ''}${co.matricule ? '<br>MF ' + escapeHtml(matriculeLisible(co.matricule)) : ''}</div>
      <hr>
      <table><tr><td><b>Ticket ${escapeHtml(d.number || '')}</b></td><td class="r">${escapeHtml(fmtDate(d.date))}${heureDuTicket(d) ? ' ' + heureDuTicket(d) : ''}</td></tr></table>
      ${cl ? `<div>Client : ${escapeHtml(cl)}</div>` : ''}
      <hr>
      <table>${t.lines.map(l => `<tr><td>${escapeHtml(l.label)}<div class="q">${escapeHtml(String(l.qty).replace('.', ','))} × ${m(l.qty ? round3(l.ttc / l.qty) : 0)}</div></td><td class="r">${m(l.ttc)}</td></tr>`).join('')}</table>
      <hr>
      <table>
        ${t.discount ? `<tr><td>Remise ${escapeHtml(String(t.discountRate).replace('.', ','))} %</td><td class="r">− ${m(remiseTtc(t))}</td></tr>` : ''}
        <tr><td>Total HT</td><td class="r">${m(t.netHT)}</td></tr>
        ${tva.map(r => `<tr><td>TVA ${r} % sur ${m(t.vatByRate[r].base)}</td><td class="r">${m(t.vatByRate[r].vat)}</td></tr>`).join('')}
        ${t.stamp ? `<tr><td>Timbre fiscal</td><td class="r">${m(t.stamp)}</td></tr>` : ''}
        <tr class="tot"><td>TOTAL TTC</td><td class="r">${m(t.netToPay)}</td></tr>
      </table>
      <hr>
      <table>
        <tr><td>${escapeHtml(mode || 'Payé')}</td><td class="r">${m(ca.recu != null && ca.mode === 'especes' ? ca.recu : t.netToPay)}</td></tr>
        ${ca.mode === 'especes' && ca.rendu ? `<tr><td>Rendu</td><td class="r">${m(ca.rendu)}</td></tr>` : ''}
      </table>
      <hr>
      <div class="c">${escapeHtml(pied).replace(/\n/g, '<br>')}</div>
    </body></html>`;
  }
  // Le bilan de la journée, sur la même bande de papier : ce que le tiroir doit contenir.
  // (plateforme, brique 126) Le Z imprimé : la même bande que le ticket et le bilan (80 ou 58 mm). Ses chiffres sont
  // ceux que le serveur a figés à la fermeture, en texte : rien ne se recompte ici.
  function zHtml(z, company) {
    const co = company || {};
    const m = v => money(Number(v), co.currency);
    const largeur = Number(co.caisseLargeur) === 58 ? 58 : 80;
    const quand = x => (x ? new Date(x).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
    const MODES = { especes: 'Espèces', carte: 'Carte', cheque: 'Chèque' };
    const ligne = (l, v, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td>${l}</td><td class="r">${v}</td></tr>`;
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Z de caisse ${escapeHtml(quand(z.fermeeLe))}</title><style>
      @page { size: ${largeur}mm auto; margin: 0; }
      html, body { margin: 0; background: #fff; color: #000; }
      body { width: ${largeur}mm; padding: 4mm 3.5mm 6mm; font: 11px/1.4 "Helvetica Neue", Arial, sans-serif; }
      .c { text-align: center; } .co { font-weight: 700; font-size: 14px; }
      hr { border: 0; border-top: 1px dashed #000; margin: 2.5mm 0; }
      table { width: 100%; border-collapse: collapse; } td.r { text-align: right; white-space: nowrap; }
      .tot td { font-weight: 700; font-size: 13px; }
    </style></head><body>
      <div class="c co">${escapeHtml(co.name || '')}</div>
      <div class="c"><b>Z de caisse</b></div>
      <div>Ouverte le ${escapeHtml(quand(z.ouverteLe))} par ${escapeHtml(z.ouvertePar || '')}</div>
      <div>Fermée le ${escapeHtml(quand(z.fermeeLe))} par ${escapeHtml(z.fermePar || '')}</div>
      <div>Poste : ${escapeHtml(z.appareil || '')}</div>
      <hr>
      <table>
        ${ligne('Tickets', z.nombre ? `${z.nombre} (${escapeHtml(z.premier || '')} à ${escapeHtml(z.dernier || '')})` : '0')}
        ${ligne('Dont TVA', m(z.tva))}
        ${ligne('Ventes TTC', m(z.total), 'tot')}
        ${(z.avoirs || []).length ? ligne(`Retours : ${z.avoirs.map(a => escapeHtml(a.numero)).join(', ')}`, `− ${m(z.retoursTtc)}`) + ligne('Net des ventes', m(z.net), 'tot') : ''}
      </table>
      <hr>
      <table>
        ${Object.entries(z.parMode || {}).map(([k, v]) => ligne(MODES[k] || escapeHtml(k), m(v))).join('')}
        ${Object.entries(z.rendu || {}).map(([k, v]) => ligne(`Rendu (${(MODES[k] || escapeHtml(k)).toLowerCase()})`, `− ${m(v)}`)).join('')}
      </table>
      <hr>
      <table>
        ${Number(z.sorties) ? ligne('Payé du tiroir pour la paie', `− ${m(z.sorties)}`) : ''}
        ${ligne('Fond de caisse', m(z.fond))}
        ${ligne('Le tiroir devait contenir', m(z.attendu), 'tot')}
        ${ligne('Espèces comptées', m(z.compte))}
        ${(z.comptage || []).map(x => ligne(`&nbsp;&nbsp;${Number(x.nombre)} × ${Number(x.valeur) >= 1 ? `${Number(x.valeur)} DT` : `${Math.round(Number(x.valeur) * 1000)} millimes`}`, m(x.total))).join('')}
        ${ligne('Écart', m(z.ecart), 'tot')}
      </table>
      <hr>
      <div class="c">Le Z est figé : il garde ces chiffres.</div>
    </body></html>`;
  }
  function bilanCaisseHtml(bilan, company) {
    const co = company || {};
    const cur = co.currency;
    const m = n => money(n, cur);
    const largeur = Number(co.caisseLargeur) === 58 ? 58 : 80;
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Bilan de caisse ${escapeHtml(fmtDate(bilan.jour))}</title><style>
      @page { size: ${largeur}mm auto; margin: 0; }
      html, body { margin: 0; background: #fff; color: #000; }
      body { width: ${largeur}mm; padding: 4mm 3.5mm 6mm; font: 11px/1.4 "Helvetica Neue", Arial, sans-serif; }
      .c { text-align: center; } .co { font-weight: 700; font-size: 14px; }
      hr { border: 0; border-top: 1px dashed #000; margin: 2.5mm 0; }
      table { width: 100%; border-collapse: collapse; } td.r { text-align: right; white-space: nowrap; }
      .tot td { font-weight: 700; font-size: 14px; }
    </style></head><body>
      <div class="c co">${escapeHtml(co.name || '')}</div>
      <div class="c">Bilan de caisse du ${escapeHtml(fmtDate(bilan.jour))}</div>
      <hr>
      <table>
        <tr><td>Tickets</td><td class="r">${bilan.nombre}</td></tr>
        <tr><td>Articles vendus</td><td class="r">${String(bilan.articles).replace('.', ',')}</td></tr>
        <tr><td>Dont TVA</td><td class="r">${m(bilan.tva)}</td></tr>
        <tr class="tot"><td>Ventes TTC</td><td class="r">${m(bilan.total)}</td></tr>
        ${bilan.retours ? `<tr><td>Retours (${escapeHtml(bilan.avoirs.join(', '))})</td><td class="r">− ${m(bilan.retoursTtc)}</td></tr><tr class="tot"><td>Net du jour</td><td class="r">${m(bilan.net)}</td></tr>` : ''}
      </table>
      <hr>
      <table>${MODES_CAISSE.map(([k, l]) => `<tr><td>${l}</td><td class="r">${m(bilan.parMode[k] || 0)}</td></tr>`).join('')}
        ${bilan.rembourse ? `<tr><td>Dont remboursé</td><td class="r">− ${m(bilan.rembourse)}</td></tr>` : ''}</table>
      <hr>
      ${bilan.tiroir != null ? `<table class="tot"><tr><td>Le tiroir doit contenir</td><td class="r">${m(bilan.tiroir)}</td></tr></table><div class="c">fond de caisse et jours précédents compris</div>` : `<div class="c">Espèces du jour : <b>${m(bilan.especes)}</b></div>`}
    </body></html>`;
  }
  // ---------- l'import depuis un tableur (10.14.0) ----------
  //
  // Quelqu'un qui démarre sur SkanFact a presque toujours DÉJÀ une liste : ses clients dans un
  // tableur, ses prix dans un fichier, ou ce que son ancien logiciel sait exporter. Les retaper un
  // à un dans un formulaire, personne ne le fait — et l'application reste vide le jour où l'on
  // voulait s'en servir. C'est la leçon du Cabinet (6.8.0 : « l'ajout se fait en collant une liste
  // depuis un tableur »), jamais portée à l'app entreprise.
  //
  // On COLLE : une sélection copiée dans Excel, LibreOffice ou Google Sheets arrive en tabulations.
  // Un fichier CSV s'ouvre aussi (point-virgule à la française, virgule à l'anglaise). Tout ce qui
  // DÉCIDE vit ici, pur : quelles colonnes, quelles lignes entrent, lesquelles existent déjà,
  // lesquelles sont refusées et pourquoi. L'écran montre le plan et l'applique, rien d'autre.
  //
  // Chaque champ porte les titres de colonne qu'on lui connaît (sans accents ni ponctuation) et le
  // séparateur qui joint deux colonnes du même champ (« Adresse 1 » et « Adresse 2 », « Nom » et
  // « Prénom »). Un champ NOMBRE ne se joint pas : la première colonne gagne.
  const IMPORT_CHAMPS = {
    clients: [
      { k: 'name', label: 'Nom / raison sociale', joint: ' ', noms: ['nom', 'noms', 'nom client', 'nom du client', 'client', 'clients', 'raison sociale', 'raison soc', 'denomination', 'denomination sociale', 'societe', 'entreprise', 'nom raison sociale', 'nom ou raison sociale', 'nom et prenom', 'nom prenom', 'prenom', 'nom complet', 'customer', 'customer name', 'name', 'company', 'company name', 'tiers', 'intitule'] },
      { k: 'contact', label: 'Personne à contacter', joint: ' ', noms: ['contact', 'personne a contacter', 'interlocuteur', 'responsable', 'nom du contact', 'contact name', 'gerant', 'representant'] },
      { k: 'matricule', label: 'Matricule fiscal / CIN', joint: ' ', noms: ['matricule', 'matricule fiscal', 'mf', 'm f', 'identifiant fiscal', 'id fiscal', 'identifiant unique', 'code tva', 'n tva', 'num tva', 'numero tva', 'cin', 'n cin', 'numero cin', 'mf cin', 'matricule fiscal cin', 'tax id', 'vat number', 'vat id'] },
      { k: 'phone', label: 'Téléphone', joint: ' / ', noms: ['telephone', 'telephones', 'tel', 'tel fixe', 'tel portable', 'portable', 'mobile', 'gsm', 'phone', 'telephone portable', 'telephone mobile', 'telephone fixe', 'numero de telephone', 'n telephone', 'num tel', 'fixe'] },
      { k: 'email', label: 'Email', joint: ', ', noms: ['email', 'e mail', 'emails', 'mail', 'courriel', 'adresse email', 'adresse e mail', 'adresse mail', 'email address', 'e mail address', 'mel'] },
      { k: 'address', label: 'Adresse', joint: '\n', noms: ['adresse', 'adresse postale', 'address', 'rue', 'siege', 'siege social', 'adresse 1', 'adresse ligne 1', 'adresse 2', 'adresse ligne 2', 'street'] },
      { k: 'complement', label: 'Code postal, ville, pays', joint: ' ', noms: ['code postal', 'cp', 'ville', 'localite', 'gouvernorat', 'delegation', 'pays', 'city', 'zip', 'zip code', 'postal code', 'country', 'region', 'cite'] },
      { k: 'notes', label: 'Notes internes', joint: '\n', noms: ['notes', 'note', 'remarque', 'remarques', 'commentaire', 'commentaires', 'observation', 'observations', 'memo', 'comment', 'comments'] }
    ],
    catalogue: [
      { k: 'label', label: 'Désignation', joint: ' ', noms: ['designation', 'libelle', 'intitule', 'produit', 'produits', 'article', 'articles', 'prestation', 'prestations', 'service', 'services', 'nom', 'nom du produit', 'nom produit', 'nom de l article', 'item', 'product', 'product name', 'name', 'titre', 'description courte'] },
      { k: 'description', label: 'Description', joint: '\n', noms: ['description', 'descriptif', 'detail', 'details', 'description longue', 'caracteristiques'] },
      { k: 'unitPrice', label: 'Prix unitaire HT', nombre: true, noms: ['prix', 'prix ht', 'prix unitaire', 'prix unitaire ht', 'pu', 'pu ht', 'p u', 'p u ht', 'prix de vente', 'prix de vente ht', 'pv', 'pv ht', 'tarif', 'tarif ht', 'price', 'unit price', 'montant', 'montant ht', 'prix hors taxe', 'prix hors taxes', 'prix unitaire hors taxe'] },
      { k: 'unitPriceTTC', label: 'Prix unitaire TTC', nombre: true, noms: ['prix ttc', 'pu ttc', 'p u ttc', 'prix unitaire ttc', 'prix de vente ttc', 'pv ttc', 'tarif ttc', 'montant ttc', 'prix toutes taxes', 'prix toutes taxes comprises'] },
      { k: 'unitCost', label: 'Coût de revient HT', nombre: true, noms: ['cout', 'cout ht', 'cout de revient', 'cout unitaire', 'cout d achat', 'prix d achat', 'prix d achat ht', 'prix achat', 'pa', 'pa ht', 'p a', 'prix de revient', 'cost', 'unit cost', 'purchase price'] },
      { k: 'vatRate', label: 'TVA (%)', nombre: true, noms: ['tva', 'tva %', 'taux tva', 'taux tva %', 'taux de tva', 'vat', 'vat %', 'taxe', 'tax', 'taux'] },
      { k: 'unit', label: 'Unité', joint: ' ', noms: ['unite', 'unites', 'u', 'unit', 'unite de vente', 'conditionnement', 'uv'] },
      { k: 'initialQty', label: 'Stock de départ', nombre: true, noms: ['stock', 'quantite', 'qte', 'qt', 'quantite en stock', 'qte en stock', 'stock initial', 'stock actuel', 'stock de depart', 'en stock', 'quantity', 'qty', 'inventaire'] }
    ]
  };
  // (plateforme) Des titres que d'autres logiciels écrivent (docs/etudes/FORMATS-REPRISE.md) : Odoo (en anglais
  // « Display Name », « Street2 » ; en français « Unité de mesure », « Quantité disponible » — « Nom affiché » et « Rue 2 »
  // se lisaient déjà par leurs mots), Sage (« N° identifiant »), un stock au coût moyen pondéré.
  const autresTitres = (type, k, noms) => { const c = IMPORT_CHAMPS[type].find(x => x.k === k); noms.forEach(n => { if (!c.noms.includes(n)) c.noms.push(n); }); };
  autresTitres('clients', 'name', ['display name']);
  autresTitres('clients', 'address', ['street2']);
  autresTitres('clients', 'matricule', ['matricule fiscale', 'n identifiant', 'numero identifiant', 'numero d identification fiscale', 'identification fiscale']);
  autresTitres('catalogue', 'unit', ['unite de mesure', 'udm']);
  autresTitres('catalogue', 'initialQty', ['quantite disponible', 'qte disponible', 'stock disponible', 'quantite en main']);
  autresTitres('catalogue', 'unitCost', ['cout moyen', 'cout moyen pondere', 'prix moyen pondere', 'pmp', 'cump']);
  // La référence d'un article : le code que la douchette lit à la caisse. Elle se reconnaît à son titre exact
  // seulement (« Code TVA » n'en est pas une).
  IMPORT_CHAMPS.catalogue.splice(1, 0, { k: 'code', label: 'Code-barres ou référence', joint: ' ', noms: ['code', 'code article', 'code produit', 'reference', 'ref', 'reference article', 'reference interne', 'ref interne', 'sku', 'code barre', 'code barres', 'code a barres', 'ean', 'barcode', 'internal reference'] });
  // Les fournisseurs : les colonnes des clients, sans celles qui ne nomment qu'un client, plus leur banque et leur RIB.
  const SEULEMENT_CLIENT = ['client', 'clients', 'nom client', 'nom du client', 'customer', 'customer name'];
  IMPORT_CHAMPS.fournisseurs = IMPORT_CHAMPS.clients.flatMap(c => {
    if (c.k === 'name') return [{ ...c, noms: c.noms.filter(n => !SEULEMENT_CLIENT.includes(n)).concat(['fournisseur', 'fournisseurs', 'nom fournisseur', 'nom du fournisseur', 'raison sociale fournisseur', 'supplier', 'supplier name', 'vendor', 'vendor name']) }];
    if (c.k !== 'notes') return [c];
    return [
      { k: 'bank', label: 'Banque', joint: ' ', noms: ['banque', 'bank', 'nom de la banque', 'nom banque', 'etablissement bancaire', 'domiciliation', 'domiciliation bancaire', 'bank name'] },
      { k: 'rib', label: 'RIB', joint: ' ', noms: ['rib', 'r i b', 'rib bancaire', 'iban', 'releve d identite bancaire', 'compte bancaire', 'coordonnees bancaires', 'bank account', 'account number'] },
      c];
  });
  // Quand le titre exact n'est pas connu, un MOT du titre peut décider — dans cet ordre, parce que
  // « Adresse email » est un email et « Prix TTC » un prix TTC, pas une adresse ni un prix HT. Les
  // mots LARGES (« client », « produit », « tva », « prix ») ne décident pas d'un titre qui parle
  // d'un code : « Code client » est un code, pas le nom du client, et joint au nom il donnerait
  // « Dupont C-0042 » sur chaque facture (le troisième élément d'une règle porte ce veto).
  const IMPORT_MOTS = {
    clients: [['email', /\b(e ?mail|courriel|mails?)\b/], ['phone', /\b(tel|telephone|portable|mobile|gsm|phone|fixe)\b/],
      ['matricule', /\b(matricule|mf|fiscal|cin)\b/], ['complement', /\b(ville|postal|pays|gouvernorat|localite|cp)\b/],
      ['address', /\b(adresse|address|rue)\b/], ['contact', /\b(contact|interlocuteur|responsable)\b/, true],
      ['notes', /\b(notes?|remarques?|commentaires?|observations?)\b/], ['name', /\b(nom|raison|societe|client|entreprise|denomination)\b/, true]],
    catalogue: [['unitPriceTTC', /\bttc\b/, true], ['unitCost', /\b(cout|achat|revient)\b/], ['vatRate', /\b(tva|vat|taxe)\b/, true],
      ['unitPrice', /\b(prix|pu|tarif|price|montant)\b/, true], ['initialQty', /\b(stock|quantite|qte|qty)\b/], ['unit', /\bunites?\b/],
      ['description', /\b(description|descriptif|details?)\b/], ['label', /\b(designation|libelle|produits?|articles?|prestations?|services?|nom|intitule)\b/, true]]
  };
  // (plateforme) Les fournisseurs : le RIB et la banque passent avant l'adresse (« Adresse de la banque » est une
  // banque) ; le nom se dit aussi « fournisseur ».
  IMPORT_MOTS.fournisseurs = [...IMPORT_MOTS.clients.filter(([k]) => ['email', 'phone', 'matricule'].includes(k)),
    ['rib', /\b(rib|iban)\b/], ['bank', /\b(banque|bank|domiciliation)\b/],
    ...IMPORT_MOTS.clients.filter(([k]) => !['email', 'phone', 'matricule', 'name'].includes(k)),
    ['name', /\b(nom|raison|societe|fournisseurs?|entreprise|denomination|supplier|vendor)\b/, true]];
  // (plateforme) 1.231.0 — les SALARIÉS par tableur (docs/revue-paie.md, M8) : une entreprise de vingt salariés qui arrive
  // ne retape pas vingt fiches. Les colonnes de la fiche, et ce qu'en écrivent les tableaux de paie (« Matricule CNSS »,
  // « Date d'embauche », « Salaire de base »).
  IMPORT_CHAMPS.salaries = [
    { k: 'name', label: 'Nom et prénom', joint: ' ', noms: ['nom', 'noms', 'nom et prenom', 'nom prenom', 'prenom nom', 'prenom', 'nom complet', 'salarie', 'salaries', 'employe', 'employes', 'nom du salarie', 'agent', 'personnel', 'name', 'employee', 'employee name', 'full name'] },
    { k: 'cin', label: 'CIN', joint: ' ', noms: ['cin', 'n cin', 'numero cin', 'num cin', 'carte d identite', 'piece d identite', 'id card'] },
    { k: 'cnss', label: 'N° CNSS', joint: ' ', noms: ['cnss', 'n cnss', 'numero cnss', 'num cnss', 'matricule cnss', 'n assure', 'numero assure', 'numero d assure', 'immatriculation cnss', 'n affiliation'] },
    { k: 'position', label: 'Poste', joint: ' ', noms: ['poste', 'fonction', 'emploi', 'qualification', 'metier', 'job', 'job title', 'position'] },
    { k: 'contract', label: 'Contrat', joint: ' ', noms: ['contrat', 'type de contrat', 'nature du contrat', 'type contrat', 'contract'] },
    { k: 'hireDate', label: 'Date d\'embauche', date: true, noms: ['date d embauche', 'embauche', 'date embauche', 'entree', 'date d entree', 'date entree', 'entre le', 'hire date', 'start date'] },
    { k: 'grossSalary', label: 'Salaire brut mensuel', nombre: true, noms: ['salaire', 'salaire brut', 'brut', 'salaire de base', 'salaire mensuel', 'brut mensuel', 'salaire brut mensuel', 'base', 'gross salary', 'salary', 'gross'] },
    { k: 'iban', label: 'RIB', joint: ' ', noms: ['rib', 'r i b', 'iban', 'compte bancaire', 'coordonnees bancaires', 'bank account'] },
    { k: 'email', label: 'Email', joint: ', ', noms: ['email', 'e mail', 'mail', 'courriel', 'adresse email', 'adresse e mail', 'adresse mail'] },
    { k: 'phone', label: 'Téléphone', joint: ' / ', noms: ['telephone', 'tel', 'portable', 'mobile', 'gsm', 'phone', 'numero de telephone'] },
    { k: 'address', label: 'Adresse', joint: '\n', noms: ['adresse', 'adresse postale', 'address', 'rue', 'domicile'] },
    { k: 'birthDate', label: 'Date de naissance', date: true, noms: ['date de naissance', 'naissance', 'ne le', 'nee le', 'ne e le', 'date naissance', 'birth date', 'date of birth'] },
    { k: 'children', label: 'Enfants à charge', nombre: true, noms: ['enfants', 'nombre d enfants', 'enfants a charge', 'nb enfants', 'nbre enfants', 'children'] },
    { k: 'headOfFamily', label: 'Chef de famille', joint: ' ', noms: ['chef de famille', 'chef famille', 'situation', 'situation familiale', 'etat civil', 'marie'] }
  ];
  IMPORT_MOTS.salaries = [['email', /\b(e ?mail|courriel|mails?)\b/], ['phone', /\b(tel|telephone|portable|mobile|gsm|phone)\b/], ['cnss', /\bcnss\b/],
    ['cin', /\bcin\b/], ['iban', /\b(rib|iban)\b/], ['birthDate', /\bnaissance\b/], ['hireDate', /\b(embauche|entree)\b/], ['grossSalary', /\b(salaire|brut)\b/],
    ['children', /\benfants?\b/], ['headOfFamily', /\b(chef|situation)\b/], ['position', /\b(poste|fonction|emploi|qualification)\b/], ['contract', /\bcontrat\b/],
    ['address', /\b(adresse|rue|domicile)\b/], ['name', /\b(nom|prenom|salaries?|employes?)\b/, true]];
  // Une date d'un tableur : « 02/01/2024 » (jour d'abord, l'usage tunisien), « 2024-01-02 », ou le numéro de jour
  // qu'Excel garde (45293). Illisible : NaN, jamais une date inventée. Vide : null.
  function dateImport(x) {
    const s = String(x == null ? '' : x).trim();
    if (!s) return null;
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    let y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; } else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; }
    else if (/^\d{5}$/.test(s)) { const t = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); return t.toISOString().slice(0, 10); }
    else return NaN;
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return NaN;
    return t.toISOString().slice(0, 10);
  }
  const memeSalarie = (a, b) => {
    const ca = String(a.cin || '').replace(/\s/g, ''), cb = String(b.cin || '').replace(/\s/g, '');
    if (ca && cb) return ca === cb;
    return !!cleNom(a.name) && cleNom(a.name) === cleNom(b.name);
  };
  function salarieVierge(o) {
    return { id: uid(), name: o.name, cin: o.cin || '', cnss: o.cnss || '', position: o.position || '', contract: o.contract || 'cdi', hireDate: o.hireDate, endDate: '',
      grossSalary: o.grossSalary, headOfFamily: !!o.headOfFamily, children: o.children || 0, method: 'virement', iban: o.iban || '', notes: '',
      ...(o.email ? { email: o.email } : {}), ...(o.phone ? { phone: o.phone } : {}), ...(o.address ? { address: o.address } : {}), ...(o.birthDate ? { birthDate: o.birthDate } : {}), active: true };
  }
  const VETO_MOTS = /\b(code|ref|reference|id|identifiant|numero|num|no|n)\b/;
  const cleEntete = titre => plier(titre).replace(/[^a-z0-9%]+/g, ' ').trim();
  function champDeEntete(type, titre) {
    const brut = String(titre == null ? '' : titre);
    // Une cellule qui porte un email ou un numéro n'est pas un titre de colonne : c'est une donnée.
    // Sans ce garde-fou, « contact@darelmarsa.tn » passait pour le titre « Contact », et la
    // première ligne d'une liste SANS titres disparaissait dans l'en-tête.
    if (brut.includes('@') || (brut.match(/\d/g) || []).length >= 5) return '';
    const t = cleEntete(brut);
    if (!t) return '';
    const exact = (IMPORT_CHAMPS[type] || []).find(c => c.noms.includes(t));
    if (exact) return exact.k;
    const mot = (IMPORT_MOTS[type] || []).find(([, re, veto]) => re.test(t) && !(veto && VETO_MOTS.test(t)));
    return mot ? mot[0] : '';
  }

  // Le découpage d'un texte collé. Un guillemet n'OUVRE un champ protégé qu'en tête de champ (c'est
  // ce qu'écrivent Excel et les CSV) : « Écran 24" » au milieu d'une désignation est un caractère,
  // pas le début d'un champ qui avalerait tout le reste du fichier. Dans un vrai champ protégé, un
  // guillemet est DOUBLÉ ; un guillemet seul qui n'est suivi ni d'un séparateur ni d'une fin de
  // ligne (« "Premium" pack ») dit que ce n'en était pas un : le champ redevient du texte ordinaire,
  // tel quel, sans aller chercher sa fermeture trois lignes plus bas. Un champ qui ne se referme
  // jamais, pareil.
  function decouperTableau(texte, sep) {
    const s = String(texte == null ? '' : texte).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const n = s.length;
    const rows = [];
    let ligne = [], i = 0;
    const brut = () => { let j = i; while (j < n && s[j] !== '\n' && s[j] !== sep) j++; const c = s.slice(i, j); i = j; return c; };
    while (i <= n) {
      let champ;
      if (s[i] === '"') {
        let j = i + 1, buf = '', ferme = -1;
        while (j < n) {
          if (s[j] === '"') {
            if (s[j + 1] === '"') { buf += '"'; j += 2; continue; }
            const apres = s[j + 1];
            if (apres === undefined || apres === '\n' || apres === sep) ferme = j;
            break;
          }
          buf += s[j]; j++;
        }
        if (ferme >= 0) { champ = buf; i = ferme + 1; } else champ = brut();
      } else champ = brut();
      ligne.push(champ);
      if (i >= n) { rows.push(ligne); break; }
      if (s[i] === sep) { i++; if (i === n) { ligne.push(''); rows.push(ligne); break; } continue; }
      rows.push(ligne); ligne = []; i++;
      if (i === n) break;
    }
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  }
  // Le séparateur se DÉDUIT : une tabulation vient d'un tableur, et elle gagne toujours. Sinon, le
  // point-virgule (un CSV à la française) puis la virgule — à condition que la moitié au moins des
  // lignes aient le même nombre de colonnes que la première : une liste de noms collée d'une seule
  // colonne (« Ben Salah, Ali ») ne se découpe pas sur ses virgules.
  function separateurTableau(texte) {
    const s = String(texte == null ? '' : texte);
    if (s.includes('\t')) return '\t';
    for (const c of [';', ',']) {
      if (!s.includes(c)) continue;
      const rows = decouperTableau(s, c).slice(0, 30);
      if (!rows.length || rows[0].length < 2) continue;
      const pareilles = rows.filter(r => r.length === rows[0].length).length;
      if (pareilles * 2 >= rows.length) return c;
    }
    return null;
  }

  // Un nombre tel qu'un tableur l'écrit : « 1 250,500 », « 25 DT », « 19 % ». Les unités se
  // retirent, le reste passe par la lecture stricte du moteur comptable (une cellule illisible
  // n'est jamais un zéro, 10.10.0 C-16) : `null` quand c'est vide, `NaN` quand ce n'est pas un nombre.
  const nombreImport = v => Compta.nombreStrict(String(v == null ? '' : v)
    .replace(/(?<![a-z])(dt|tnd|dinars?|millimes?|eur|euros?|usd|ht|ttc)(?![a-z])\.?/gi, '').replace(/[€$%]/g, '').trim());
  // Une unité telle qu'on l'écrit : « pièce », « Heure », « m2 ». Ce qui correspond à une unité de
  // la liste prend son code ; le reste est gardé tel quel (et rejoint la liste, comme une unité
  // saisie à la main, `usedUnits`).
  const UNITES_ECRITES = { unite: 'u', unites: 'u', un: 'u', pce: 'u', pc: 'u', piece: 'u', pieces: 'u', heure: 'h', heures: 'h', hr: 'h', hrs: 'h',
    jour: 'j', jours: 'j', m2: 'm²', 'metre carre': 'm²', m3: 'm³', 'metre cube': 'm³', 'metre lineaire': 'ml', litre: 'L', litres: 'L', l: 'L',
    kilogramme: 'kg', kilo: 'kg', kilos: 'kg', annee: 'an', ans: 'an' };
  function uniteImport(v) {
    const t = String(v == null ? '' : v).trim();
    if (!t) return '';
    const p = plier(t).replace(/\.$/, '').trim();
    const connue = LINE_UNITS.find(([code, lib]) => plier(code) === p || plier(lib) === p || plier(lib.replace(/\s*\(.*\)$/, '')) === p);
    if (connue) return connue[0];
    return UNITES_ECRITES[p] || t;
  }
  // Deviner une colonne à son CONTENU, quand aucun titre ne parle : un email se reconnaît, un
  // matricule tunisien aussi, un taux de TVA ne prend que quatre valeurs. Le reste est laissé à
  // « Ignorer » : l'écran montre la colonne et son contenu, la personne choisit.
  function devinerColonnes(type, lignes, largeur) {
    const out = new Array(largeur).fill('');
    const echantillon = lignes.slice(0, 50);
    const part = (i, test) => {
      const v = echantillon.map(r => String(r[i] == null ? '' : r[i]).trim()).filter(Boolean);
      return v.length ? v.filter(test).length / v.length : 0;
    };
    const estNombre = x => { const n = nombreImport(x); return n !== null && !Number.isNaN(n); };
    const libre = i => !out[i];
    if (type === 'salaries') {
      for (let i = 0; i < largeur; i++) {
        if (part(i, x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) >= 0.6) out[i] = 'email';
        else if (part(i, x => /^\d{20}$/.test(x.replace(/[\s.-]/g, ''))) >= 0.6) out[i] = 'iban';
        else if (part(i, x => /^\d{8}$/.test(x)) >= 0.6) out[i] = 'cin';
        else if (part(i, x => typeof dateImport(x) === 'string') >= 0.8) out[i] = out.includes('hireDate') ? (out.includes('birthDate') ? '' : 'birthDate') : 'hireDate';
      }
      const nom = [...out.keys()].find(i => libre(i) && part(i, x => !estNombre(x)) >= 0.6);
      if (nom != null) out[nom] = 'name';
      const brut = [...out.keys()].find(i => libre(i) && part(i, x => estNombre(x) && Number(nombreImport(x)) >= 100) >= 0.8);
      if (brut != null) out[brut] = 'grossSalary';
      return out;
    }
    if (type === 'clients' || type === 'fournisseurs') {
      for (let i = 0; i < largeur; i++) {
        if (part(i, x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) >= 0.6) out[i] = 'email';
        else if (part(i, x => /^\d{7}\s*[/-]?\s*[a-z]/i.test(x)) >= 0.6) out[i] = 'matricule';
        else if (type === 'fournisseurs' && part(i, x => /^\d{20}$/.test(x.replace(/[\s.-]/g, ''))) >= 0.6) out[i] = 'rib';
        else if (part(i, x => /^[+(\d][\d\s().\/-]{6,}$/.test(x) && (x.match(/\d/g) || []).length >= 8) >= 0.6) out[i] = 'phone';
      }
      const nom = [...out.keys()].find(i => libre(i) && part(i, x => !estNombre(x)) >= 0.6);
      if (nom != null) out[nom] = 'name';
    } else {
      const lab = [...out.keys()].find(i => part(i, x => !estNombre(x)) >= 0.6);
      if (lab != null) out[lab] = 'label';
      const nombres = [...out.keys()].filter(i => libre(i) && part(i, estNombre) >= 0.8);
      const tva = nombres.find(i => part(i, x => VAT_RATES.includes(Number(nombreImport(x)))) === 1);
      const prix = nombres.find(i => i !== tva);
      if (prix != null) out[prix] = 'unitPrice';
      if (tva != null && prix != null) out[tva] = 'vatRate';
    }
    return out;
  }

  // Une clé pour reconnaître un doublon : le matricule d'abord (sept chiffres, comme la console et le
  // Cabinet), le nom sinon — sans accents, sans ponctuation, sans espaces en trop. Deux homonymes
  // aux matricules DIFFÉRENTS ne sont pas le même client.
  const cleNom = nom => plier(nom).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  function memeClient(a, b) {
    const ma = chiffresMatricule(a.matricule), mb = chiffresMatricule(b.matricule);
    if (ma && mb) return ma === mb;
    return !!cleNom(a.name) && cleNom(a.name) === cleNom(b.name);
  }

  // Le PLAN d'un import. `choix` : { entete: bool (sinon deviné), champs: [clé par colonne] (sinon
  // déduits des titres, ou du contenu faute de titres) }. Chaque ligne rend son statut :
  //   nouveau   — elle entre ;
  //   existe    — elle désigne une fiche déjà là : on COMBLE ses cases vides (`complete`), jamais
  //               on ne remplace ce qui est rempli (10.9.1 — une fiche appartient à son auteur) ;
  //   remplace  — (catalogue) elle désigne une prestation d'EXEMPLE de l'assistant : ses prix sont
  //               les tiens, l'exemple devient ta prestation (10.12.0 — un prix posé par le
  //               logiciel n'est pas un prix décidé) ;
  //   doublon   — même fiche qu'une ligne plus haut dans la liste collée ;
  //   refus     — une cellule illisible ou un nom qui manque : la ligne n'entre pas, et le motif
  //               nomme la ligne et ce qui y est écrit (une cellule illisible n'est jamais un zéro).
  function planImport(type, texte, data, company, choix) {
    const champs = IMPORT_CHAMPS[type];
    if (!champs) throw new Error('Import : type inconnu « ' + type + ' »');
    const o = choix || {};
    const d = data || {};
    const co = company || d.company || {};
    const sep = separateurTableau(texte);
    const brutes = decouperTableau(texte, sep).map(r => r.map(c => String(c == null ? '' : c)));
    const largeur = brutes.reduce((m, r) => Math.max(m, r.length), 0);
    const reconnus = brutes.length ? Array.from({ length: largeur }, (_, i) => champDeEntete(type, brutes[0][i])) : [];
    // Une ligne de TITRES : plus de la moitié de ses cases désignent une colonne connue. Un seul mot
    // reconnu dans une ligne de données (« Client Dupont », « Contact Pro SARL ») ne suffit pas à
    // la faire disparaître dans l'en-tête ; la case à cocher de l'écran tranche sinon.
    const pleines = brutes.length ? brutes[0].filter(c => String(c || '').trim()).length : 0;
    const titresConnus = reconnus.filter(Boolean).length;
    const entete = o.entete != null ? !!o.entete : (titresConnus > 0 && titresConnus * 2 > pleines);
    // La MAUVAISE liste (vu à la souris) : un tarif collé dans l'import des CLIENTS annonçait
    // « 7 nouveaux clients », dont un nommé « Désignation » — aucun de ses titres n'est celui d'un
    // client, donc aucun n'était reconnu, donc chaque ligne devenait un client. Quand la première
    // ligne n'est PAS une ligne de titres de ce type mais qu'elle en est une, à plus de moitié, de
    // l'AUTRE, la liste a sans doute été collée dans la mauvaise fenêtre : le plan le DIT
    // (`autreListe`), et l'écran propose de l'importer là où elle va. Cocher « la première ligne
    // donne les titres » passe outre : c'est un choix, et il se respecte.
    const autre = type === 'catalogue' ? 'clients' : 'catalogue';
    const titresAutre = brutes.length && o.entete == null && !entete
      ? brutes[0].map(c => String(c || '').trim()).filter(c => champDeEntete(autre, c)) : [];
    const autreListe = titresAutre.length && titresAutre.length * 2 > pleines ? autre : '';
    const titres = entete && brutes.length ? Array.from({ length: largeur }, (_, i) => String(brutes[0][i] || '').trim()) : [];
    const donnees = entete ? brutes.slice(1) : brutes;
    let colonnes;
    if (Array.isArray(o.champs) && o.champs.length) colonnes = Array.from({ length: largeur }, (_, i) => champs.some(c => c.k === o.champs[i]) ? o.champs[i] : '');
    else if (entete) colonnes = reconnus.slice();
    else colonnes = devinerColonnes(type, donnees, largeur);
    // Un champ NOMBRE n'a qu'une colonne : la première gagne, les suivantes sont ignorées (et le
    // disent, puisque leur liste repasse sur « Ignorer »).
    champs.filter(c => c.nombre).forEach(c => { let vu = false; colonnes = colonnes.map(k => { if (k !== c.k) return k; if (vu) return ''; vu = true; return k; }); });
    // Un catalogue sans colonne « Désignation » mais avec une « Description » : c'est elle qui nomme
    // (« Description / Prix », l'usage anglais). Sans ça, chaque ligne serait refusée faute de nom.
    if (type === 'catalogue' && !colonnes.includes('label') && colonnes.includes('description')) colonnes[colonnes.indexOf('description')] = 'label';

    const lire = (r, k) => {
      const c = champs.find(x => x.k === k);
      const vals = colonnes.map((kk, i) => kk === k ? String(r[i] == null ? '' : r[i]).trim() : '').filter(Boolean);
      return c && c.nombre ? (vals[0] || '') : vals.join(c ? c.joint : ' ');
    };
    const assujetti = assujettiTVA(co);
    const vatDefaut = defaultVat(co);
    const existants = type === 'clients' ? (d.clients || []) : type === 'fournisseurs' ? (d.suppliers || []) : type === 'salaries' ? (d.employees || []) : (d.catalog || []);
    const vus = [];
    const lignes = donnees.map((r, idx) => {
      const n = idx + (entete ? 2 : 1);
      const extrait = r.map(c => String(c || '').trim()).filter(Boolean).slice(0, 3).join(', ');
      const ligne = { n, cellules: r, statut: 'nouveau', motifs: [], avert: [], complete: [], existant: null };
      const refus = m => { ligne.statut = 'refus'; ligne.motifs.push(`Ligne ${n}${extrait ? ` (${extrait})` : ''} : ${m}`); };
      if (type === 'salaries') {
        const num = (k, quoi) => { const b = lire(r, k); const v = nombreImport(b); if (v === null) return null; if (Number.isNaN(v) || v < 0) { refus(`« ${b} » n'est pas ${quoi}. Écris-le en chiffres.`); return null; } return v; };
        const dat = (k, quoi) => { const b = lire(r, k); const v = dateImport(b); if (v === null) return ''; if (Number.isNaN(v)) { refus(`« ${b} » n'est pas une date (${quoi}) : écris-la jour/mois/année, comme 02/01/2024.`); return ''; } return v; };
        const ctr = plier(lire(r, 'contract'));
        const contrat = !ctr ? 'cdi' : (CONTRACT_TYPES.find(([k]) => ctr === k || ctr.startsWith(k) || ctr.includes(k)) || [''])[0];
        const chef = plier(lire(r, 'headOfFamily'));
        const obj = { name: lire(r, 'name'), cin: lire(r, 'cin'), cnss: lire(r, 'cnss'), position: lire(r, 'position'), contract: contrat || 'cdi',
          hireDate: dat('hireDate', 'son embauche'), grossSalary: num('grossSalary', 'un salaire') || 0, iban: lire(r, 'iban').replace(/[\s.-]/g, ''), email: lire(r, 'email'),
          phone: lire(r, 'phone'), address: lire(r, 'address'), birthDate: dat('birthDate', 'sa naissance'), children: Math.round(num('children', 'un nombre d\'enfants') || 0),
          headOfFamily: /^(oui|o|x|1|vrai|yes|y|chef|chef de famille|marie|mariee)\b/.test(chef) };
        ligne.objet = obj;
        if (!obj.name) refus('le nom manque — c\'est lui qui s\'imprime sur son bulletin.');
        if (ligne.statut !== 'refus' && !obj.hireDate) refus('la date d\'embauche manque — sans elle, aucun bulletin.');
        if (ligne.statut !== 'refus' && !(obj.grossSalary > 0)) refus('le salaire brut manque — sans lui, aucun bulletin.');
        if (ctr && !contrat) ligne.avert.push(`contrat « ${lire(r, 'contract')} » inconnu : il entre en CDI, change-le sur sa fiche s'il le faut.`);
        if (obj.iban && !/^\d{20}$/.test(obj.iban)) ligne.avert.push(`le RIB « ${lire(r, 'iban')} » n'a pas les vingt chiffres d'un RIB tunisien : relis-le avant le premier virement.`);
        if (obj.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(obj.email)) ligne.avert.push(`l'email « ${obj.email} » n'a pas la forme d'une adresse.`);
        if (ligne.statut === 'refus') return ligne;
        const avant = vus.find(v => memeSalarie(v.objet, obj));
        if (avant) { ligne.statut = 'doublon'; ligne.motifs.push(`même salarié que la ligne ${avant.n}`); return ligne; }
        const ex = existants.find(c => memeSalarie(c, obj));
        if (ex) { ligne.statut = 'existe'; ligne.existant = ex.id; ligne.complete = ['cin', 'cnss', 'position', 'iban', 'email', 'phone', 'address', 'birthDate'].filter(k => obj[k] && !String(ex[k] || '').trim()); }
        vus.push(ligne);
        return ligne;
      }
      if (type === 'clients' || type === 'fournisseurs') {
        const fournisseur = type === 'fournisseurs';
        const adr = [lire(r, 'address'), lire(r, 'complement')].filter(Boolean).join('\n');
        const obj = { name: lire(r, 'name'), contact: lire(r, 'contact'), matricule: lire(r, 'matricule'), phone: lire(r, 'phone'), email: lire(r, 'email'), address: adr, notes: lire(r, 'notes') };
        if (fournisseur) Object.assign(obj, { bank: lire(r, 'bank'), rib: lire(r, 'rib') });
        ligne.objet = obj;
        if (!obj.name) refus(fournisseur ? 'le nom manque — c\'est lui qui se lit sur chaque achat.' : 'le nom manque — c\'est lui qui s\'imprime sur chaque pièce.');
        if (obj.email && !obj.email.split(/\s*,\s*/).every(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) ligne.avert.push(`l'email « ${obj.email} » n'a pas la forme d'une adresse : un envoi n'arriverait pas.`);
        // Un RIB tunisien a vingt chiffres : un autre se garde tel quel (un IBAN étranger), et se dit avant le virement.
        if (obj.rib && !/^\d{20}$/.test(obj.rib.replace(/[\s.-]/g, ''))) ligne.avert.push(`le RIB « ${obj.rib} » n'a pas les vingt chiffres d'un RIB tunisien : relis-le avant le premier virement.`);
        if (ligne.statut === 'refus') return ligne;
        const avant = vus.find(v => memeClient(v.objet, obj));
        if (avant) { ligne.statut = 'doublon'; ligne.motifs.push(`même ${fournisseur ? 'fournisseur' : 'client'} que la ligne ${avant.n}`); return ligne; }
        const ex = existants.find(c => memeClient(c, obj));
        if (ex) {
          ligne.statut = 'existe'; ligne.existant = ex.id;
          ligne.complete = ['contact', 'matricule', 'phone', 'email', 'address', 'notes'].concat(fournisseur ? ['bank', 'rib'] : []).filter(k => obj[k] && !String(ex[k] || '').trim());
        }
        vus.push(ligne);
        return ligne;
      }
      // Le catalogue. Chaque nombre dit ce qu'il est, et son refus aussi — accordé à la main :
      // « une quantité négatif » se lit.
      const nombre = (k, quoi, negatif) => {
        const brut = lire(r, k);
        const v = nombreImport(brut);
        if (v === null) return null;
        if (Number.isNaN(v)) { refus(`« ${brut} » n'est pas ${quoi}. Écris-le en chiffres.`); return null; }
        if (v < 0) { refus(`${negatif} (« ${brut} ») n'existe pas.`); return null; }
        return v;
      };
      const label = lire(r, 'label');
      if (!label) refus('la désignation manque — c\'est elle qui s\'écrit sur la ligne du devis.');
      let vat = null;
      const vBrut = lire(r, 'vatRate');
      if (vBrut) {
        let v = nombreImport(vBrut);
        if (v !== null && !Number.isNaN(v) && v > 0 && v < 1) v = Math.round(v * 10000) / 100;
        if (v === null || Number.isNaN(v) || !VAT_RATES.includes(v)) refus(`TVA « ${vBrut} » inconnue : SkanFact connaît ${liste(VAT_RATES.map(x => x + ' %'))}.`);
        else vat = v;
      }
      if (vat == null) vat = vatDefaut;
      if (!assujetti && vat > 0) { ligne.avert.push(`TVA mise à 0 % au lieu de ${vat} % : ton régime ne facture pas de TVA.`); vat = 0; }
      let prix = nombre('unitPrice', 'un prix', 'un prix négatif');
      const ttc = nombre('unitPriceTTC', 'un prix', 'un prix négatif');
      if (prix == null && ttc != null) prix = round3(ttc / (1 + vat / 100));
      const cout = nombre('unitCost', 'un coût', 'un coût négatif');
      const qte = nombre('initialQty', 'une quantité', 'un stock de départ négatif');
      const obj = { label, code: lire(r, 'code'), description: lire(r, 'description'), unit: uniteImport(lire(r, 'unit')), unitPrice: prix || 0, unitCost: cout || 0, vatRate: vat };
      if (qte) Object.assign(obj, { tracked: true, initialQty: qte, initialCost: cout || 0 });
      ligne.objet = obj;
      if (ligne.statut === 'refus') return ligne;
      const memeArticle = (a, b) => (String(a.code || '').trim() && String(b.code || '').trim() ? plier(String(a.code).trim()) === plier(String(b.code).trim()) : cleNom(a.label) === cleNom(b.label));
      const avant = vus.find(v => memeArticle(v.objet, obj));
      if (avant) { ligne.statut = 'doublon'; ligne.motifs.push(`même prestation que la ligne ${avant.n}`); return ligne; }
      const ex = existants.find(c => memeArticle(c, obj));
      if (ex && ex.fromSetup) { ligne.statut = 'remplace'; ligne.existant = ex.id; }
      else if (ex) {
        ligne.statut = 'existe'; ligne.existant = ex.id;
        ligne.complete = [['code', !String(ex.code || '').trim() && obj.code], ['description', !String(ex.description || '').trim() && obj.description], ['unit', !String(ex.unit || '').trim() && obj.unit],
          ['unitCost', !(Number(ex.unitCost) > 0) && obj.unitCost > 0]].filter(([, oui]) => oui).map(([k]) => k);
        // Le stock d'une prestation qui existe déjà a peut-être déjà bougé : un stock de départ
        // posé après coup réécrirait son histoire. On le DIT au lieu de l'avaler (règle 9.8.0).
        if (obj.tracked) ligne.avert.push('le stock de départ n\'est pas repris sur une prestation qui existe déjà : passe par un mouvement sur la page Stock.');
      }
      // Un stock de départ SANS coût d'achat vaut zéro : la valeur du stock l'affiche, et chaque
      // vente le sort au coût nul — sa marge paraît trop belle, sans un mot (vu à la souris : un
      // tarif collé avec sa colonne « Stock » et sans colonne « Coût » annonçait 258 articles
      // valant 0,000 DT). On ne l'invente pas : on le DIT, là où l'on peut encore l'ajouter.
      if (obj.tracked && !(obj.initialCost > 0) && ligne.statut !== 'existe') {
        ligne.avert.push(`stock de départ de ${qte} sans coût d'achat : il vaudra 0 dans ton stock, et la marge de ses ventes paraîtra trop belle tant que tu n'as pas renseigné ce coût (une colonne « Coût » dans ta liste, ou sa fiche).`);
      }
      vus.push(ligne);
      return ligne;
    });
    const compte = st => lignes.filter(l => l.statut === st).length;
    // Les exemples de l'assistant que la liste n'a pas repris : on propose de les retirer, s'ils ne
    // servent à aucune pièce — un catalogue de quarante prix réels n'a que faire de huit exemples.
    const repris = new Set(lignes.filter(l => l.statut === 'remplace').map(l => l.existant));
    const servi = c => [...(d.documents || []), ...(d.templates || []), ...(d.recurring || [])]
      .some(x => (x.lines || []).some(l => l.itemId === c.id || cleNom(l.label) === cleNom(c.label)));
    const exemples = type === 'catalogue' && lignes.some(l => ['nouveau', 'remplace'].includes(l.statut))
      ? (d.catalog || []).filter(c => c.fromSetup && !repris.has(c.id) && !servi(c)).map(c => ({ id: c.id, label: c.label }))
      : [];
    return {
      type, sep, entete, titres, colonnes, largeur, lignes, exemples, autreListe, titresAutre: autreListe ? titresAutre : [],
      nouveaux: compte('nouveau'), remplaces: compte('remplace'), doublons: compte('doublon'), refus: compte('refus'),
      completes: lignes.filter(l => l.statut === 'existe' && l.complete.length).length,
      inchanges: lignes.filter(l => l.statut === 'existe' && !l.complete.length).length,
      // Un stock de départ EST un mouvement de stock : l'écran le passe par le garde-fou de l'offre,
      // comme la fiche d'un article (7.33.0).
      stock: lignes.some(l => ['nouveau', 'remplace'].includes(l.statut) && l.objet && l.objet.tracked)
    };
  }

  // Appliquer un plan : les nouvelles fiches entrent, les existantes se COMPLÈTENT (jamais un champ
  // rempli ne change), les exemples repris deviennent tiens, et — si on l'a demandé — les exemples
  // restés sans usage partent (et le disent à l'autre poste d'un dossier partagé, `trackDeletion`).
  function appliquerImport(data, plan, company, opts) {
    const o = opts || {};
    const out = { crees: [], completes: 0, remplaces: 0, retires: 0 };
    const clients = plan.type === 'clients';
    const fournisseurs = plan.type === 'fournisseurs';
    const salaries = plan.type === 'salaries';
    if (fournisseurs && !Array.isArray(data.suppliers)) data.suppliers = [];
    if (salaries && !Array.isArray(data.employees)) data.employees = [];
    const liste = clients ? data.clients : fournisseurs ? data.suppliers : salaries ? data.employees : data.catalog;
    const jour = o.jour || today();
    plan.lignes.forEach(l => {
      if (l.statut === 'nouveau') {
        const x = clients ? clientVierge(l.objet) : fournisseurs ? fournisseurVierge(l.objet) : salaries ? salarieVierge(l.objet) : articleVierge(company, l.objet, jour);
        liste.push(x); out.crees.push(x.id);
      } else if (l.statut === 'existe' && l.complete.length) {
        const x = liste.find(y => y.id === l.existant);
        if (x) { l.complete.forEach(k => { x[k] = l.objet[k]; }); out.completes++; }
      } else if (l.statut === 'remplace') {
        const x = liste.find(y => y.id === l.existant);
        if (x) {
          ['label', 'unitPrice', 'vatRate'].forEach(k => { x[k] = l.objet[k]; });
          ['code', 'description', 'unit'].forEach(k => { if (l.objet[k]) x[k] = l.objet[k]; });
          if (l.objet.unitCost) x.unitCost = l.objet.unitCost;
          // Un exemple de l'assistant n'a jamais été suivi en stock (l'enregistrer lui retire son
          // repère d'exemple) : son stock de départ n'a pas d'histoire à réécrire.
          if (l.objet.tracked) Object.assign(x, { tracked: true, initialQty: l.objet.initialQty, initialCost: l.objet.initialCost, initialDate: jour });
          delete x.fromSetup;
          out.remplaces++;
        }
      }
    });
    if (o.retirerExemples && plan.exemples && plan.exemples.length) {
      const ids = new Set(plan.exemples.map(e => e.id));
      data.catalog.filter(c => ids.has(c.id)).forEach(c => trackDeletion(data, 'catalog', c.id, c.label));
      const avant = data.catalog.length;
      data.catalog = data.catalog.filter(c => !ids.has(c.id));
      out.retires = avant - data.catalog.length;
    }
    return out;
  }

  // Déplacé dans compta.js (10.14.1) : le Cabinet lit les mêmes fichiers Excel (plan, balance,
  // écritures) et ne charge pas core.js. Réexporté à l'IDENTITÉ — une copie divergerait.
  const lireFichierTexte = Compta.lireFichierTexte;

  // ---------- pagination et tri des listes ----------
  // Découpage d'une liste en pages. `size` à 0 (ou moins) = tout afficher.
  // Renvoie des bornes déjà corrigées : une page hors limites est ramenée dans l'intervalle,
  // ce qui évite l'écran vide quand un filtre réduit la liste alors qu'on est en page 5.
  function pageInfo(total, page, size) {
    total = Math.max(0, Math.floor(Number(total) || 0));
    size = Math.floor(Number(size) || 0);
    if (size <= 0) return { page: 1, pages: 1, size: 0, start: 0, end: total, from: total ? 1 : 0, to: total, total };
    const pages = Math.max(1, Math.ceil(total / size));
    const p = Math.min(Math.max(1, Math.floor(Number(page) || 1)), pages);
    const start = (p - 1) * size;
    const end = Math.min(total, start + size);
    return { page: p, pages, size, start, end, from: total ? start + 1 : 0, to: end, total };
  }

  // Comparaison générique pour le tri d'une colonne : nombres en numérique, textes en français
  // (« Élan » avant « Zone »), les valeurs vides toujours en fin de tri croissant.
  function compareValues(x, y) {
    const xEmpty = x == null || x === '', yEmpty = y == null || y === '';
    if (xEmpty || yEmpty) return xEmpty && yEmpty ? 0 : (xEmpty ? 1 : -1);
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return TRI_FR.compare(String(x), String(y));
  }

  const api = {
    enLot, duLot,
    CLIENT_COMPTOIR, MODES_CAISSE, estTicket, estRetourDeTicket, estCession, serieDe, titreDePiece, normCode, articleParCode, comptesDeCaisse, compteDuMode, ligneDePanier, prixDuPanier, totauxDuPanier, motifEncaissement, MOTIF_SANS_BANQUE, ticketDeCaisse, bilanCaisse, heureDuTicket, resteARendre, remboursementDeTicket, ticketHtml, bilanCaisseHtml, zHtml,
    VAT_RATES, WITHHOLDING_RATES, PAYMENT_METHODS, PREFIX, TITLES, DEFAULT_DATA, DEFAULT_COMPANY, ACTIVITIES, STATUSES, STATUT_ENVOI, DISPLAY_STATUSES, STATUS_LABELS,
    REGIMES, regimeOf, regimeSuggere, tfpSuggere, assujettiTVA, mentionTVA, estLiberal, docLabel, ribAttendu,
    DOC_FILTRES, docFiltre,
    pageInfo, compareValues, LINE_UNITS, usedUnits, uniteAccordee, usedWithholdingRates, parseDateInput, fmtDateInput, monthMatrix,
    uid, round3, money, fmtDate, addDays, daysInMonth, today, jourDeLInstant, escapeHtml, nl2br, capitalAffiche, statusLabel,
    // (plateforme) 1.60.0 — le pointage.
    CODES_POINTAGE, CODES_REPOS, libellePointage, pointageEnregistre, pointageDuMois, poserPointage, poserHeuresSup, heuresSupDuJour: Compta.heuresSupDuJour, poserHeuresSupDuJour: Compta.poserHeuresSupDuJour, poserRetard: Compta.poserRetard, equipeDe: Compta.equipeDe, joursReposDe: Compta.joursReposDe, ferieDu: Compta.ferieDu, lireBadges: Compta.lireBadges, importerBadges: Compta.importerBadges, journeeBadges: Compta.journeeBadges, anomaliesPointage: Compta.anomaliesPointage, poserSortie: Compta.poserSortie, majorationsHs, heuresDuMoisDe: Compta.heuresDuMoisDe, ecartDeRappel: Compta.ecartDeRappel, heuresSupDuMois, retardsDuMois, heuresDeNuitDuMois, reprisePointage, pointageSurBulletin,
    plier, correspondRecherche, rangRecherche, classerRecherche, delaiJours, typoFr,
    CLOSURE_ACTIONS, closedUntil, isClosedDate, closedPeriodLabel, closableMonths, rienACloturer, closureChecks, closePeriod, reopenPeriod, closureLog,
    PACK_FORMAT, packPeriod, packPlan, packChecklist, packFileName, packCoverHtml,
    // Les justificatifs (10.14.1, S-04)
    nomsJustificatifs, justificatifsDe, sansJustificatif, referenceAchat,
    DEFAULT_ACCOUNTS, ACCOUNT_LABELS, ENTRY_JOURNALS, journalLabel, chartAccounts, journalEntries,
    entriesBalance, entriesByAccount, entryCsvColumns, fecEntreprise, MOVE_ACCOUNTS, COMPTES_CONTREPARTIE, journalDeCompte, clotureValide,
    // Les questions du cabinet (9.10.0)
    QUESTION_ATTENDUS, QUESTION_RELANCE, questionsValides, fusionnerQuestionsRecues,
    questionsDeLaPiece, repondreQuestion, reponsesAEnvoyer, reponsesApres, questionsSansReponse, verdictEnvoiCabinet,
    numerosDuJournal, livreJournal, journalCentralisateur, centralisateurCsvColumns, centralisateurRows, inPeriod,
    odValide, odPiece, comptesProposes, lettrage, SECTIONS_ECRITURES,
    etatRapprochement, etatsFinanciers, etatsCsvRows, etatsCsvColumns, employerChargesOf,
    PLAN_COMPTABLE, accountLabel, classeDe, compteDeGestion, auxiliairesActifs, codesAuxiliaires, numeroterAuxiliaires,
    debutExercice, soldesOuverture, balanceGenerale, grandLivre, grandLivreRows, balanceAuxiliaire,
    balanceCsvColumns, balanceAuxCsvColumns, grandLivreCsvColumns,
    salesCsvColumns, buyCsvColumns, payCsvColumns, supplierPayCsvColumns, cashCsvColumns, cashCsvRows,
    estRemboursementAchat, avoirRembourse, aRattacherAchat, nextNumber, isLocked, isIssued, computeTotals, creditsFor, invoiceBalance, estRemboursement, titreQuestion, gesteQuestion, dateDernierReglement, motifVerrou, delaisContradictoires, effectiveStatus,
    depositLines, depositLinesMontant, acompteDit, settlementLines, salesJournal, vatSummary, paymentsJournal, toCsv, migrateData,
    PERIODS, MONTHS_FR, MONTHS_SHORT, monthLabel, deLibelle, addMonths, nextRecurrenceDate, dueRecurrences, periodesDues, contratTermine, catchUpRecurrence, fillTemplate, buildRecurringInvoice,
    estTitre, sousTotauxDeSections,
    reminderLevel, REMINDER_LABELS, daysBetween, factureEnRetard, overdueInvoices, RELANCE_ATTENTE, aRelancer, relancesParClient, relanceGroupee, facturesAVenir, todoList, companyGaps, matriculeBienForme, matriculeLisible, verifRib, documentHistory, DEFAULT_EMAIL_TEMPLATES, DEFAULT_EMAIL_TEMPLATES_EN, emailFor, numeroWhatsApp, lienWhatsApp,
    CURRENCIES, DEVISES_NOMS, libelleDevise, TYPES_NUMEROTES, etatNumerotation, poserNumerotation, premiereNumerotation, normCurrency, DEPOT_PRINCIPAL, depotsDe, nomDepot, stockParDepot, transfertStock, decimalsFor, listesPrixApplicables, prixArticlePour, arrondiDevise, prixDuCatalogue, prixCataloguePourQuantite, lirePaliers, paliersEnTexte, toBase, rateOf, missingRate, monthKeys, monthlySeries, topClients, quoteStats, avgPaymentDelay, clientSummary, I18N,
    EXTRA_TYPES, SALES_TYPES, CONVERSIONS, CONVERSION_LABELS, convertDoc, retenueDuClient, derivedDocs, chaineDePieces, DEFAULT_CLAUSES, CLAUSE_LABELS,
    BON_LIVRE, suiviCommande, resteALivrerDit, livraisonDeCommande, bonsDeFacture, factureDuBon, bonsAFacturer, factureDeBons,
    STATUTS_COMMANDE_FOURNISSEUR, numeroSuivant, suiviCommandeFournisseur, statutCommandeFournisseur, receptionDeCommande, receptionsAFacturer, lignesAchatDeReceptions, copieLigneAchat, ecartsAchatReceptions, demandesDuGroupe, comparerDemandes, commandesFournisseurEnRetard, montantCommandeFournisseur, encoursClient, depassementEncours,
    PURCHASE_KINDS, PURCHASE_LIES, piecesLieesAchat, LINE_DESTINATIONS, DEFAULT_EXPENSE_CATEGORIES, PURCHASE_STATUSES, expenseCategories,
    vatReturn, vatChain, declarationsDuCabinet, reportTvaDebut, DEFAULT_FISCAL_DEADLINES, fiscalDeadlines, nextDeadline, upcomingFiscal, calendrierFiscal, dateLimiteSociale, dateLimiteDeclarationSociale, fiscalFilingId, fiscalDone, echeanceSociale, socialesDeposees, simpleResult,
    ACCOUNT_KINDS, MOVE_KINDS, virementVers, virementCotes, tauxDuReglement, montantRegle, ecartDuReglement, compteDepuisFiche, cashMovements, accountBalance, cashPosition, cashForecast, semainesTreso, delaiClient, portefeuilleEffets, natureDuReleve, apparierReleve, reconciliation,
    lineCost, documentMargin, MODES_PRIX, ARRONDIS_PRIX, calculPrix, marginBy, PROJECT_STATUSES, projectMargin, projectList, avancementAffaire, etatDesChantiers, suiviAffaire, quantitesSortiesPourAffaire, achatDansAffaire, affaireDeLigne, affairesDeLAchat, partageEntreAffaires, coutAchatPourAffaire, coutHoraire, heuresDeLAffaire, margeMoisParMois, affaireHtml, recurringProfitability, piecesDuContrat, contratSuivi,
    DEFAULT_FIXED_CATEGORIES, isFixedCategory, breakEven,
    DEFAULT_ASSET_CLASSES, assetClassLabel, assetClassYears, days360, assetSchedule, assetYear,
    assetCumulated, assetNBV, disposalResult, assetsList, assetTotals, assetsToCreate, immosEnAttente, immosHorsTableau, ligneDeFiche, biensADiminuer, depreciationFor,
    cappedCumulated,
    moisDePaie, anneesDePaie, paieDuMois, paieATraiter, controlesDuMois, montantSocial, initialesDe, couleurDe, premierePieceApres, MOVE_SOURCES, SOURCES_SORTIE, qteMouvement, moveSourceLabel, trackedItems, itemOfLine, stockParLot, lotConseille, lotsAPerimer, lotsDeLaPiece, stockMovements, runningStock, stockOf, estKit, composantsDe, lignesDeStock, kitsPossibles, coutDuKit,
    stockList, stockTotals, stockJournal, inventoryDiff, stockAlerts, quantiteACommander, fournisseurDeLArticle, ventesDeLArticle, commandesEnCoursDeLArticle, stockImpact, sortieAuBon, costOfGoodsSold, inventaireComptable, coutAchat, sceauEcritures, ecartsSceau,
    ocrNumber, ocrToPurchase,
    CONTRACT_TYPES, contractLabel, REGIME_TAUX: Compta.REGIME_TAUX, regimeDuContrat: Compta.regimeDuContrat, normaliserRegimes: Compta.normaliserRegimes, libelleRegime: Compta.libelleRegime,
    DEFAULT_PAYROLL, payrollSettings, irppAnnual, computePayslip, saisiePaieValide, primesDuMois, saisieDeLaFiche, tauxAvant2026,
    cssPoseePour: Compta.cssPoseePour, baremesNonRelus: Compta.baremesNonRelus, CSS_JUSQU_AU: Compta.CSS_JUSQU_AU,
    activeEmployees, payslipView, payslipsOf, payslipDate, payrollCost, payrollSummary, missingPayslips, bulletinsImpossibles,
    payslipHtml,
    // (plateforme) 1.61.0 — le journal de paie et les états de la paie.
    joursPayesDuBulletin, COLONNES_JOURNAL, journalDePaie, colonnesCsvJournal, journalDePaieHtml, etatRecapitulatifCnss, etatRecapitulatifCnssHtml, declarationMensuelleSalaires,
    QUARTERS, quarterMonths, quarterLabel, cnssDeclaration, fichierCnssEntreprise, lireMatriculeCnss: Compta.lireMatriculeCnss, identiteCnss: Compta.identiteCnss, motifIdentiteCnss: Compta.motifIdentiteCnss, cnssNonDeclaree, employerAnnual, COLONNES_SALAIRES_ANNEE, salairesAPayer, ordreDeVirementHtml, socialDue, recuSalaireEspecesHtml,
    LEAVE_KINDS, leaveKindLabel, leaveIsPaid, workingDays, leaveDaysInMonth, leavesOf, leaveBalance,
    advancesOf, advanceBalance, payslipInputFor, congeRetenu: Compta.congeRetenu, brutDuMois: Compta.brutDuMois, saisiesOf: Compta.saisiesOf, regulsDuMois: Compta.regulsDuMois,
    // (plateforme) 1.256.0
    brutPourNet: Compta.brutPourNet, anneesAnciennete: Compta.anneesAnciennete, trancheAnciennete: Compta.trancheAnciennete, variablesDuMois: Compta.variablesDuMois, indemniteLicenciement: Compta.indemniteLicenciement, HR_DOCS, hrDocLabel, hrDocumentHtml, staffRegister,
    // (plateforme) 1.72.0 — du moteur commun : la civilité, l'indemnité de congés non pris, les lignes du solde.
    CIVILITES, indemniteConges, lignesDuSolde,
    SERIAL_STATUSES, serialStatusLabel, WARRANTY_CHOICES, serializedItems, warrantyEnd, serialView,
    serialList, availableSerials, clientFleet, warrantiesEnding, serialGap, serialGaps,
    propositionsDeGarantie, garantiesAProposer, garantiesParClient, ligneDeMaintenance,
    mergeData, trackDeletion, MERGE_LISTS, LIST_LABELS, LIST_PLURIELS, compteListe, piecesLiees,
    purchaseTotals, purchaseBalance, retenueDesReglements, retenueAOperer, retenueChrono, regularisationsRetenueAchats, retenueSubie, retenueASubir, regularisationsRetenueVentes, retenuesDeLaPeriode, attestationsARecevoir, purchaseStatus, achatEnRetard, achatDoublon, facturesDuDevis, payablesList, detteFournisseurs, purchaseJournal, purchaseSummary, supplierSummary, withholdingsToIssue, attestationsRS, exonerationRS, derniereAttestationRS, tauxRetenueFournisseur, etatExonerationRS, exonerationsAFaire, noteExonerationRS, masqueDate, appliquerAttestationRS, mentionExonerationRS, supplierPayments,
    remiseEffective,
    periodBounds, issuedIn, salesTotals, revenueByMonth, topItems, clientMovement, AGING_BUCKETS, agedReceivables, releveClient, releveHtml, mailReleve, payerRanking, quoteFunnel, objectiveProgress, ventesParCanal, encaisseSur, achatsRepartis, motifsDeRefus,
    amountToWords, intToWords, intToWordsEn, documentHtml, fitToPage, paginate, pageCount,
    MODULES, PAGES, moduleById, pageById, pageTitle, moduleCount, moduleCounts, modulesRevenus, moduleOn, moduleWhy, navPages, familleNavOuverte, FAMILLES_OUVERTES_AU_DEBUT, FAMILLES_DU_MENU, vuesDePage,
    sousModuleOn, sousModuleById, sousModules, OPTION_LABELS,
    MODULES_PAR_ACTIVITE, modulesSuggeres, wipeData, rendreLesEmprunts, estDemo, exemplePerime, verdictMotDePasse, firstSteps, reussites, liste, defaultVat, seuilRetenue, sousSeuilRetenue, newLine, tauxPourRegime, tvaRecuperable, tvaNonDeductible, achatsHorsRegime, tauxAchatArticle, articlesSansTva, sourcesSansTva, factureSansTvaSuspecte, ligneFactureeSansTva, regimePourPiece, modelesParDefaut, modeleMail,
    contrasteSurBlanc, lisibiliteMarque, ACCENTS_PROPOSES, marquePersonnalisee,
    canalDe, estBeta, pastilleLicence, empreinteCabinet, licencesDuCabinet,
    LICENCE_MOTIFS, prorataOffre, licenceSuivi, licencesAFaire,
    EXPORT_CONSOLE_DELAI, exportConsoleAFaire,
    LICENCE_PREAVIS, licenceEtat, licenceRows, licencesExpirant,
    clientPourVente, chargeHistorique, facturesAAnnoncer,
    // L'import depuis un tableur, et le modèle vierge d'une fiche (10.14.0)
    clientVierge, articleVierge, fournisseurVierge, IMPORT_CHAMPS, dateImport, champDeEntete, decouperTableau, separateurTableau, uniteImport,
    planImport, appliquerImport, lireFichierTexte,
    // (plateforme) Dessiner un code QR : `qrImage(texte)` rend un <svg>. Vide ici ; la page le branche (brique 83).
    qrImage: null
  };
  // Les calculs qui LISENT beaucoup ouvrent leur propre lot : appelés d'un test, de la palette ou du
  // processus principal, ils profitent des index sans que l'appelant y pense. Aucun ne modifie les
  // données — un calcul qui écrit n'a rien à faire ici, il lirait ses propres index périmés.
  ['overdueInvoices', 'todoList', 'journalEntries', 'livreJournal', 'journalCentralisateur', 'agedReceivables',
    'cashForecast', 'cashMovements', 'payablesList', 'detteFournisseurs', 'stockList', 'stockTotals', 'stockJournal', 'stockAlerts',
    'inventoryDiff', 'costOfGoodsSold', 'salesTotals', 'revenueByMonth', 'topItems', 'clientMovement', 'payerRanking',
    'quoteFunnel', 'releveClient', 'packPlan', 'packChecklist', 'closureChecks', 'simpleResult', 'breakEven',
    'marginBy', 'projectList', 'projectMargin', 'suiviAffaire', 'margeMoisParMois', 'affaireHtml', 'clientSummary', 'supplierSummary', 'balanceGenerale', 'grandLivre', 'etatsFinanciers', 'lettrage', 'firstSteps', 'reussites']
    .forEach(n => { const f = api[n]; if (typeof f === 'function') api[n] = function () { return enLot(() => f.apply(this, arguments)); }; });
  return api;
});
