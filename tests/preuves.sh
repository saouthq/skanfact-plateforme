#!/bin/bash
# Les preuves par réintroduction (règle du projet) : chaque test doit TOMBER quand on remet le
# défaut qu'il surveille. Un test qui reste vert sur son défaut ne mesure rien.
# Chaque défaut est posé dans une COPIE du dépôt : le code n'est jamais touché.
#
#   PG_ADMIN=postgres://… bash tests/preuves.sh
set -u
ICI="$(cd "$(dirname "$0")/.." && pwd)"
: "${PG_ADMIN:?PG_ADMIN manque (adresse d'un compte d'administration PostgreSQL)}"
ok=0; ko=0

prouver() { # défaut, fichier, avant, après, test qui doit tomber
  local nom="$1" fichier="$2" avant="$3" apres="$4" attendu="$5"
  local copie; copie="$(mktemp -d)"
  (cd "$ICI" && tar --exclude=node_modules --exclude=.git -cf - .) | (cd "$copie" && tar -xf -)
  ln -s "$ICI/node_modules" "$copie/node_modules"
  # Plusieurs retouches à la fois : fichiers, avants et après séparés par « ||| ».
  python3 - "$copie" "$fichier" "$avant" "$apres" <<'EOF'
import sys
racine, fichiers, avants, apres = sys.argv[1:5]
fichiers, avants, apres = fichiers.split('|||'), avants.split('|||'), apres.split('|||')
if len(fichiers) == 1: fichiers = fichiers * len(avants)
for f, a, b in zip(fichiers, avants, apres):
    p = racine + '/' + f
    s = open(p, encoding='utf-8').read()
    assert s.count(a) == 1, f"motif introuvable ou multiple dans {p} : {a!r}"
    open(p, 'w', encoding='utf-8').write(s.replace(a, b))
EOF
  (cd "$copie" && npx vitest run --reporter=json --outputFile=resultat.json >/dev/null 2>&1)
  if python3 - "$copie/resultat.json" "$attendu" <<'EOF'
import json, sys
r = json.load(open(sys.argv[1]))
tombes = [t['title'] for f in r['testResults'] for t in f['assertionResults'] if t['status'] == 'failed']
sys.exit(0 if any(sys.argv[2] in t for t in tombes) else 1)
EOF
  then echo "PROUVÉE       $nom → « $attendu » tombe"; ok=$((ok+1))
  else echo "NON PROUVÉE   $nom → « $attendu » reste vert"; ko=$((ko+1)); fi
  rm -rf "$copie"
}

M=base/migrations/0001_socle.sql
prouver "l'entreprise visible par tous" $M \
  "create policy visible on socle.entreprise
  using (id in (select socle.mes_entreprises()));" "create policy visible on socle.entreprise using (true);" \
  "le propriétaire de B ne voit rien de A"
prouver "la sécurité par ligne non forcée sur une table" $M \
  "alter table socle.etablissement force row level security;" "" \
  "chaque table du socle a sa sécurité par ligne, forcée"
prouver "un mandat seulement proposé qui ouvre l'accès" $M \
  "where d.statut = 'actif'
     and d.debut" "where d.debut" \
  "pas celui dont le mandat est seulement proposé"
prouver "un mandat dont la date est passée qui ouvre encore l'accès" $M \
  "and d.debut <= current_date and (d.fin is null or d.fin >= current_date)" "" \
  "un mandat dont la date de fin est passée"
prouver "tout le cabinet voit tous les dossiers" $M \
  "and ('supervision' = any(m.roles)" "and (true" \
  "le collaborateur voit le dossier qui lui est confié"
prouver "le dossier tenu vu par tout le cabinet" $M \
  "and exists (select 1 from socle.organisation o where o.id = e.organisation and o.type <> 'cabinet')" "" \
  "un dossier tenu, rangé dans le cabinet"
prouver "on écrit chez la voisine" $M \
  "create policy visible on socle.etablissement
  using (entreprise in (select socle.mes_entreprises()));" "create policy visible on socle.etablissement
  using (entreprise in (select socle.mes_entreprises())) with check (true);" \
  "il ne peut pas écrire chez sa voisine"
prouver "l'annuaire de toutes les personnes" base/migrations/0002_connexion.sql \
  "create policy lire on socle.utilisateur for select using (id in (select socle.mes_collegues()));" "create policy lire on socle.utilisateur for select using (true);" \
  "on voit son équipe, pas l'annuaire"
prouver "les appareils des autres visibles" $M \
  "using (utilisateur = socle.moi());" "using (true);" \
  "on ne voit que ses propres appareils"
prouver "le rôle du serveur passe au-dessus de la sécurité" $M \
  "alter role skanfact_app nologin nosuperuser nobypassrls" "alter role skanfact_app nologin nosuperuser bypassrls" \
  "le compte du serveur ne passe jamais au-dessus"
prouver "deux propriétaires pour une entreprise" $M \
  "create unique index membre_un_proprietaire on socle.membre (entreprise)
  where actif and entreprise is not null and 'proprietaire' = any(roles);" "" \
  "une entreprise n'a qu'un seul propriétaire"
prouver "créer une entreprise sans dire qui on est" $M \
  "  if socle.moi() is null then" "  if false then" \
  "personne ne crée d'entreprise sans dire qui il est"
prouver "le nom de la personne gardé par la connexion" serveur/base.ts \
  "\$1, true)" "\$1, false)" \
  "une connexion rendue au pool ne garde jamais le nom"
prouver "une migration modifiée acceptée" base/migrer.ts \
  "if (deja !== m.empreinte)" "if (deja === 'jamais')" \
  "une migration déjà appliquée puis modifiée est refusée"

# ── La connexion (03 § 6) ────────────────────────────────────────────────────────────────────────
C=base/migrations/0002_connexion.sql
S=serveur/connexion.ts
prouver "l'attente ne commence jamais" $C \
  "  if v_erreurs >= 5 then" "  if v_erreurs >= 500 then" \
  "après 5 erreurs, 1 minute"
prouver "un blocage définitif" $C \
  "      else interval '60 minutes' end;" "      else interval '100 years' end;" \
  "après 5 erreurs, 1 minute"
prouver "le propriétaire dispensé du code" $C \
  "array['proprietaire', 'administrateur', 'paie', 'supervision', 'revision', 'saisie']" "array['administrateur', 'paie', 'supervision', 'revision', 'saisie']" \
  "un propriétaire sans code"
prouver "un appareil reconnu pour un an" $C \
  "reconnu_jusqu_au = p_maintenant + interval '30 days'" "reconnu_jusqu_au = p_maintenant + interval '365 days'" \
  "ne redemande le code qu'après 30 jours"
prouver "le poste d'un autre dispensé du code" $S \
  "!(reconnu && !posteDUnAutre)" "!reconnu" \
  "sur le poste d'un autre"
prouver "le poste d'un autre gardé 12 heures" $C \
  "case when p_poste_d_un_autre then interval '30 minutes' else interval '12 hours' end" "case when p_poste_d_un_autre then interval '12 hours' else interval '12 hours' end" \
  "sur le poste d'un autre"
prouver "une session qui ne tombe jamais" $C \
  "then interval '30 minutes' else interval '12 hours' end" "then interval '30 minutes' else interval '48 hours' end" \
  "une session ordinaire tombe après 12 heures"
prouver "un code qui sert deux fois" $C \
  "   where d.id = p_defi and d.resolu_le is null and" "   where d.id = p_defi and" \
  "un code ne sert qu'une fois"
prouver "un code valable une heure" $S \
  "const DUREE_DEFI = '10 minutes';" "const DUREE_DEFI = '60 minutes';" \
  "un code trop vieux"
prouver "un code de secours qui sert deux fois" $C \
  "where c.utilisateur = p_utilisateur and c.utilise_le is null" "where c.utilisateur = p_utilisateur" \
  "un code de secours remplace le code, une seule fois"
prouver "un appareil révoqué qui garde ses sessions" "$C|||$C" \
  "     and not exists (select 1 from socle.appareil a where a.id = s.appareil and a.revoque_le is not null)|||  update socle.session set fermee_le = p_maintenant where appareil = p_appareil and fermee_le is null;" \
  "|||" \
  "un appareil révoqué perd ses sessions"
prouver "on révoque l'appareil d'un autre" $C \
  "where id = p_appareil and utilisateur = socle.moi() and revoque_le is null;" "where id = p_appareil and revoque_le is null;" \
  "on ne révoque que les siens"
prouver "le SMS emporte plus que le numéro et le code" $S \
  '`Ton code SkanFact : ${code.slice(0, 3)} ${code.slice(3)}`' '`Ton code SkanFact : ${code.slice(0, 3)} ${code.slice(3)} (${demande.email})`' \
  "par SMS : seuls le numéro et le code partent"
prouver "l'empreinte d'un collègue lisible" $C \
  "grant select (id, email, nom, telephone, telephone_verifie_le, langue, code_methode, cree_le) on socle.utilisateur to skanfact_app;" "grant select on socle.utilisateur to skanfact_app;" \
  "personne ne voit l'empreinte d'un autre"
prouver "on se donne un rôle soi-même" $C \
  "revoke insert, update on socle.membre, socle.mandat from skanfact_app;" "" \
  "personne ne voit l'empreinte d'un autre"
prouver "une adresse inconnue qui se trahit" $S \
  "      return a ? { etat: 'attendre', jusqua: a, motif: attenteLisible(a, maintenant) } : { etat: 'refuse', motif: MOTIF_REFUS };" \
  "      return a ? { etat: 'attendre', jusqua: a, motif: attenteLisible(a, maintenant) } : { etat: 'refuse', motif: u ? MOTIF_REFUS : 'Adresse inconnue.' };" \
  "une adresse inconnue et un mauvais mot de passe"
prouver "un mot de passe gardé en clair" serveur/mot-de-passe.ts \
  "export const empreinte = (motDePasse: string): Promise<string> => hash(motDePasse);" "export const empreinte = (motDePasse: string): Promise<string> => Promise.resolve(motDePasse);" \
  "il n'est gardé qu'en empreinte Argon2id"
prouver "le jeton gardé en clair" $S \
  "[demande.defi, sha256(jeton), maintenant" "[demande.defi, jeton, maintenant" \
  "le jeton n'est gardé qu'en empreinte"
prouver "un code TOTP trop vieux accepté" serveur/totp.ts \
  "return [-1, 0, 1].some(" "return [-4, -3, -2, -1, 0, 1].some(" \
  "pas celui d'il y a deux minutes"
prouver "un mot de passe volé accepté" serveur/mot-de-passe.ts \
  "  if (liste.contient(motDePasse)) {" "  if (false) {" \
  "10 caractères au moins, et jamais un mot de passe déjà volé"

echo; echo "$ok preuves faites, $ko non prouvées."
[ "$ko" -eq 0 ]
