// La porte (03 D1, D2) : `peut(qui, entreprise, geste)` rend toujours un objet, jamais un booléen nu.
// Elle pose les trois questions DANS L'ORDRE et nomme la première réponse qui manque :
//   1. cette personne voit-elle cette entreprise ? (la sécurité par ligne de la base le dit)
//   2. le geste est-il possible ici et maintenant ? (offre, abonnement, mois fermé : les modules
//      branchent leurs conditions ici ; aucune au socle pour l'instant)
//   3. son rôle le permet-il ?
// `qui` : les personnes qui ont ce droit, parmi les membres ACTIFS (jamais une personne absente,
// D4) ; `bouton` : le geste qui débloque, s'il existe.

import { motif, t, type Texte } from '../../textes/index.ts';
import type { Transaction } from '../base.ts';
import { GESTES, nomDuRole, type Geste, type Role } from './gestes.ts';

export type Decision =
  | { ok: true; geste: Geste; roles: Role[]; lectureSeule: boolean }
  | { ok: false; raison: 'code_a_configurer' | 'invisible' | 'condition' | 'role' | 'geste_inconnu'; motif: Texte;
      qui: { utilisateur: string; nom: string; roles: string[] }[]; bouton: string | null };

export type QuiAgit = { utilisateur: string; codeAConfigurer?: boolean; cle?: { gestes: string[] } | undefined };

// Une condition « ici et maintenant » (2e question), branchée par un module : elle rend un refus
// ou rien.
export type Condition = (tx: Transaction, entreprise: string, geste: Geste) => Promise<{ motif: Texte; bouton: string | null } | null>;
const conditions: Condition[] = [];

// Ce qu'il faut au mandat d'un cabinet pour les gestes de chaque module (03 § 3.4) : l'une des
// cases. Un module absent d'ici est fermé au cabinet (l'équipe, les réglages, les ventes à émettre).
const PERIMETRE_DU_MODULE: Record<string, string[]> = {
  compta: ['comptabilite'], ventes: ['comptabilite'], achats: ['comptabilite', 'saisie_achats'], paie: ['paie'],
};
export function brancherCondition(c: Condition) { conditions.push(c); }

async function quiPeut(tx: Transaction, entreprise: string, geste: Geste) {
  const permis = Object.entries(geste.roles).filter(([, a]) => a === 'oui').map(([r]) => r);
  const r = await tx.query(
    `select m.utilisateur, u.nom, m.roles from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
      where m.entreprise = $1 and m.actif and m.roles && $2::text[] order by u.nom`, [entreprise, permis]);
  return r.rows.map((x) => ({ utilisateur: x.utilisateur as string, nom: x.nom as string, roles: x.roles as string[] }));
}

export async function peut(tx: Transaction, qui: QuiAgit, entreprise: string, codeGeste: string, pourEcrire?: boolean): Promise<Decision> {
  const geste = GESTES.get(codeGeste);
  if (!geste) return { ok: false, raison: 'geste_inconnu', motif: motif('porte.geste_inconnu', { geste: codeGeste }), qui: [], bouton: null };
  const ecrire = pourEcrire ?? geste.ecrit;

  // 0. Le code sur le téléphone est obligatoire et pas encore en place : rien d'autre avant.
  if (qui.codeAConfigurer) {
    return { ok: false, raison: 'code_a_configurer', motif: motif('commun.code_requis'), qui: [], bouton: 'compte.code.configurer' };
  }

  // 1. Voit-il l'entreprise ? C'est la base qui répond (sécurité par ligne).
  const voit = (await tx.query('select 1 from socle.entreprise where id = $1', [entreprise])).rowCount;
  // Ce qui n'est jamais à portée ne se montre pas (D3) : on ne dit même pas que l'entreprise existe.
  if (!voit) return { ok: false, raison: 'invisible', motif: motif('commun.introuvable'), qui: [], bouton: null };

  // 2. Possible ici et maintenant ?
  for (const c of conditions) {
    const refus = await c(tx, entreprise, geste);
    if (refus) return { ok: false, raison: 'condition', motif: refus.motif, qui: [], bouton: refus.bouton };
  }

  // 3. Une clé de l'API : sa liste de gestes, comme un rôle ; ce qui gouverne l'entreprise ne se
  //    donne jamais à une clé, même si la liste le dit (03 § 8).
  if (qui.cle) {
    if (!geste.horsCle && qui.cle.gestes.includes(geste.code)) return { ok: true, geste, roles: [], lectureSeule: false };
    return { ok: false, raison: 'role', qui: [], bouton: null, motif: motif('porte.cle_refuse', { geste: t(`geste.${geste.code}`) }) };
  }

  // 3. Son rôle ? L'union de ses rôles (D7).
  const roles = (await tx.query('select socle.mes_roles($1) r', [entreprise])).rows[0].r as Role[];
  // Qui n'agit ici QUE par son cabinet agit dans le périmètre du mandat (03 § 3.4) : ce que le
  // propriétaire n'a pas ouvert ne s'ouvre pas, quel que soit le rôle au cabinet.
  const perimetre = (await tx.query('select socle.perimetre_cabinet($1) p', [entreprise])).rows[0].p as string[] | null;
  if (perimetre !== null) {
    const ouvrent = geste.perimetre ?? PERIMETRE_DU_MODULE[geste.module] ?? [];
    if (!ouvrent.some((p) => perimetre.includes(p))) {
      return { ok: false, raison: 'role', qui: [], bouton: null,
        motif: motif('porte.hors_perimetre', { geste: t(`geste.${geste.code}`), perimetre: ouvrent.length ? ouvrent.map((p) => t(`perimetre.${p}`)) : t('porte.aucun_perimetre') }) };
    }
  }
  const acces = roles.map((r) => geste.roles[r]).filter(Boolean);
  const permis = acces.includes('oui') || (!ecrire && acces.includes('voir'));
  if (permis) return { ok: true, geste, roles, lectureSeule: !acces.includes('oui') };

  const quiA = await quiPeut(tx, entreprise, geste);
  const valeurs = { roles: roles.length ? roles.map(nomDuRole) : t('porte.aucun_role'), geste: t(`geste.${geste.code}`), noms: quiA.map((q) => q.nom) };
  return {
    ok: false, raison: 'role', qui: quiA,
    motif: motif(quiA.length ? 'porte.role_refuse_qui' : 'porte.role_refuse', valeurs),
    // Le bouton qui débloque : demander à quelqu'un qui peut — seulement s'il existe (D4).
    bouton: quiA.length ? 'demander' : null,
  };
}
