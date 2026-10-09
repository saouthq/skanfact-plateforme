#!/bin/bash
# Les preuves par réintroduction (règle du projet) : chaque test doit TOMBER quand on remet le
# défaut qu'il surveille. Un test qui reste vert sur son défaut ne mesure rien.
# Chaque défaut est posé dans une COPIE du dépôt : le code n'est jamais touché.
#
#   PG_ADMIN=postgres://… bash tests/preuves.sh
#
# Pendant le travail, on peut restreindre (sur GitHub, toutes, à chaque envoi) :
#   SEULES=motif    les preuves dont le NOM y répond ;
#   FICHIERS=motif  les preuves dont le test visé vit dans un fichier dont le chemin y répond ;
#   NOMS=fichier    les preuves dont le nom est une ligne de ce fichier (tests/preuves-nouvelles.sh).
# PARTIE=k/n : le k-ième groupe sur n (une preuve sur n, à partir de la k-ième) ; chaque groupe a sa
# propre base de test, et les n groupes tournent côte à côte (tests/preuves-paralleles.sh, et n
# machines sur GitHub). Un groupe qui ne prouve pas tout échoue, comme le lot entier.
set -u
ICI="$(cd "$(dirname "$0")/.." && pwd)"
: "${PG_ADMIN:?PG_ADMIN manque (adresse d'un compte d'administration PostgreSQL)}"
ok=0; ko=0; rang=0
groupe=1; groupes=1
if [ -n "${PARTIE:-}" ]; then
  if ! [[ "$PARTIE" =~ ^([0-9]+)/([0-9]+)$ ]] || [ "${BASH_REMATCH[1]}" -lt 1 ] || [ "${BASH_REMATCH[1]}" -gt "${BASH_REMATCH[2]}" ]; then
    echo "PARTIE=$PARTIE ne va pas : k/n, avec 1 ≤ k ≤ n" >&2; exit 2
  fi
  groupe="${BASH_REMATCH[1]}"; groupes="${BASH_REMATCH[2]}"
  export SKANFACT_TEST_GROUPE="$groupe"
fi

prouver() { # défaut, fichier, avant, après, test qui doit tomber
  local nom="$1" fichier="$2" avant="$3" apres="$4" attendu="$5"
  rang=$((rang+1))
  if [ $(( (rang - 1) % groupes )) -ne $((groupe - 1)) ]; then return 0; fi
  if [ -n "${SEULES:-}" ] && ! [[ "$nom" =~ $SEULES ]]; then return 0; fi
  if [ -n "${NOMS:-}" ] && ! grep -Fxq -- "$nom" "$NOMS"; then return 0; fi
  if [ -n "${FICHIERS:-}" ] && ! python3 - "$ICI/tests" "$attendu" "$FICHIERS" <<'PYF'
import sys, pathlib, re
racine, titre, motif = sys.argv[1], sys.argv[2], sys.argv[3]
for f in sorted(pathlib.Path(racine).rglob('*.test.ts')):
    t = f.read_text(encoding='utf-8')
    if (titre in t or titre.replace("'", "\\'") in t) and re.search(motif, str(f)): sys.exit(0)
sys.exit(1)
PYF
  then return 0; fi
  local copie; copie="$(mktemp -d)"
  # Sans dist/ : les photos des tests d'écran (18 Mo), qu'aucun test ne lit.
  (cd "$ICI" && tar --exclude=node_modules --exclude=.git --exclude=./dist -cf - .) | (cd "$copie" && tar -xf -)
  ln -s "$ICI/node_modules" "$copie/node_modules"
  # Plusieurs retouches à la fois : fichiers, avants et après séparés par « ||| ». Un défaut qui ne se pose pas (son
  # motif absent de la copie) ne prouve rien : la preuve échoue, sans jouer le test (vu le 05/10/2026 : une copie prise
  # pendant une reconstruction des écrans, le test tombé pour une autre raison, compté « prouvée »).
  if ! python3 - "$copie" "$fichier" "$avant" "$apres" <<'EOF'
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
  then
    echo "NON PROUVÉE   $nom → le défaut ne se pose pas dans la copie"; ko=$((ko+1))
    if [ -n "${GITHUB_ACTIONS:-}" ]; then m="$nom → le défaut ne se pose pas"; echo "::error title=Preuve non prouvée::${m//%/%25}"; fi
    rm -rf "$copie"; return 0
  fi
  # Seuls les fichiers qui contiennent le titre visé sont rejoués (ses apostrophes y sont échappées) :
  # TOUS ceux qui le contiennent, car deux fichiers peuvent porter la même phrase (ne rejouer que le
  # premier a laissé verts des défauts que l'autre attrapait) ; s'il n'est trouvé nulle part, toute
  # la suite.
  local cible; cible="$(python3 - "$copie/tests" "$attendu" <<'EOF'
import sys, pathlib
racine, titre = sys.argv[1], sys.argv[2]
for f in sorted(pathlib.Path(racine).rglob('*.test.ts')):
    texte = f.read_text(encoding='utf-8')
    if titre in texte or titre.replace("'", "\\'") in texte:
        print(f.relative_to(pathlib.Path(racine).parent))
EOF
)"
  # Les fichiers de travail de vitest restent dans la copie, effacée ensuite (sinon ils
  # s'entassent dans /tmp : environ 500 Ko par lancement).
  mkdir -p "$copie/.tmp"
  # Un chemin par ligne, sans espace : le découpage de $cible est voulu.
  # shellcheck disable=SC2086
  (cd "$copie" && TMPDIR="$copie/.tmp" npx vitest run $cible --reporter=json --outputFile=resultat.json >/dev/null 2>&1)
  if python3 - "$copie/resultat.json" "$attendu" <<'EOF'
import json, sys
r = json.load(open(sys.argv[1]))
tombes = [t['title'] for f in r['testResults'] for t in f['assertionResults'] if t['status'] == 'failed']
sys.exit(0 if any(sys.argv[2] in t for t in tombes) else 1)
EOF
  then echo "PROUVÉE       $nom → « $attendu » tombe"; ok=$((ok+1))
  else
    echo "NON PROUVÉE   $nom → « $attendu » reste vert"; ko=$((ko+1))
    # Sur GitHub, une annotation aussi : tests/verdict-github.sh la lit sans le journal complet.
    if [ -n "${GITHUB_ACTIONS:-}" ]; then m="$nom → « $attendu » reste vert"; echo "::error title=Preuve non prouvée::${m//%/%25}"; fi
  fi
  rm -rf "$copie"
}

M=base/migrations/0001_socle.sql
# socle.mes_entreprises() est redéfinie par 0007 (les clés de l'API) : ses preuves visent la
# définition EN VIGUEUR. Une preuve qui vise une définition remplacée reste verte (code mort).
prouver "l'entreprise visible par tous" $M \
  "create policy visible on socle.entreprise
  using (id in (select socle.mes_entreprises()));" "create policy visible on socle.entreprise using (true);" \
  "le propriétaire de B ne voit rien de A"
prouver "la sécurité par ligne non forcée sur une table" $M \
  "alter table socle.etablissement force row level security;" "" \
  "chaque table de chaque schéma a sa sécurité par ligne, forcée"
prouver "un mandat seulement proposé qui ouvre l'accès" base/migrations/0007_cles_api.sql \
  "where d.statut = 'actif'
     and d.debut" "where d.debut" \
  "pas celui dont le mandat est seulement proposé"
prouver "un mandat dont la date est passée qui ouvre encore l'accès" base/migrations/0007_cles_api.sql \
  "and d.debut <= current_date and (d.fin is null or d.fin >= current_date)" "" \
  "un mandat dont la date de fin est passée"
prouver "tout le cabinet voit tous les dossiers" base/migrations/0007_cles_api.sql \
  "and ('supervision' = any(m.roles)" "and (true" \
  "le collaborateur voit le dossier qui lui est confié"
prouver "le dossier tenu vu par tout le cabinet" base/migrations/0007_cles_api.sql \
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
prouver "créer une entreprise sans dire qui on est" base/migrations/0072_matricule_a_la_porte.sql \
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
# Depuis le 09/10/2026 (décision de Skander, 0076) : le code du téléphone n'est exigé que d'un comptable de cabinet.
C76=base/migrations/0076_code_facultatif.sql
prouver "un comptable de cabinet dispensé du code" $C76 \
  "and m.roles && array['supervision', 'revision', 'saisie']::text[])
    from socle.utilisateur u where lower(u.email) = lower(trim(p_email))" "and m.roles && array['revision', 'saisie']::text[])
    from socle.utilisateur u where lower(u.email) = lower(trim(p_email))" \
  "un comptable de cabinet sans code : une session qui ne sert qu"
prouver "le propriétaire forcé au code à la connexion" $C76 \
  "and m.roles && array['supervision', 'revision', 'saisie']::text[])
    from socle.utilisateur u where lower(u.email) = lower(trim(p_email))" "and m.roles && array['proprietaire', 'supervision', 'revision', 'saisie']::text[])
    from socle.utilisateur u where lower(u.email) = lower(trim(p_email))" \
  "un propriétaire entre sans code du téléphone : recommandé, jamais imposé"
prouver "le propriétaire forcé au code à chaque requête" $C76 \
  "and exists (select 1 from socle.membre m where m.utilisateur = socle.moi() and m.actif
                  and m.roles && array['supervision', 'revision', 'saisie']::text[])
\$\$;" "and exists (select 1 from socle.membre m where m.utilisateur = socle.moi() and m.actif
                  and m.roles && array['proprietaire', 'supervision', 'revision', 'saisie']::text[])
\$\$;" \
  "un propriétaire continue sans code du téléphone"
prouver "un appareil reconnu pour un an" $C \
  "reconnu_jusqu_au = p_maintenant + interval '30 days'" "reconnu_jusqu_au = p_maintenant + interval '365 days'" \
  "ne redemande le code qu'après 30 jours"
prouver "le poste d'un autre dispensé du code" $S \
  "const faut = (aUnCode || u.code_obligatoire) && !(reconnu && !posteDUnAutre);" "const faut = (aUnCode || u.code_obligatoire) && !reconnu;" \
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
prouver "un appareil révoqué qui garde ses sessions" "base/migrations/0062_relais_caissier.sql|||$C" \
  "     and not exists (select 1 from socle.appareil a where a.id = s.appareil and a.revoque_le is not null)|||  update socle.session set fermee_le = p_maintenant where appareil = p_appareil and fermee_le is null;" \
  "|||" \
  "un appareil révoqué perd ses sessions"
prouver "on révoque l'appareil d'un autre" $C \
  "where id = p_appareil and utilisateur = socle.moi() and revoque_le is null;" "where id = p_appareil and revoque_le is null;" \
  "on ne révoque que les siens"
prouver "le SMS emporte plus que le numéro et le code" $S \
  '{ code: `${code.slice(0, 3)} ${code.slice(3)}` }' '{ code: `${code.slice(0, 3)} ${code.slice(3)} (${demande.email})` }' \
  "par SMS : seuls le numéro et le code partent"
prouver "l'empreinte d'un collègue lisible" $C \
  "grant select (id, email, nom, telephone, telephone_verifie_le, langue, code_methode, cree_le) on socle.utilisateur to skanfact_app;" "grant select on socle.utilisateur to skanfact_app;" \
  "personne ne voit l'empreinte d'un autre"
prouver "on se donne un rôle soi-même" $C \
  "revoke insert, update on socle.membre, socle.mandat from skanfact_app;" "" \
  "personne ne voit l'empreinte d'un autre"
prouver "une adresse inconnue qui se trahit" $S \
  "      return a ? { etat: 'attendre', jusqua: a, motif: attenteLisible(a, maintenant) } : { etat: 'refuse', motif: MOTIF_REFUS() };" \
  "      return a ? { etat: 'attendre', jusqua: a, motif: attenteLisible(a, maintenant) } : { etat: 'refuse', motif: u ? MOTIF_REFUS() : motif('connexion.code_faux') };" \
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

# ── L'équipe, la porte et la trace (0003) ──────────────────────────────────────────────────────
E=base/migrations/0003_equipe_et_trace.sql
G=serveur/porte/gestes.ts
PO=serveur/porte/porte.ts
A=serveur/app.ts
R=serveur/routes/socle.ts
prouver "un geste donné à un rôle que le tableau ne nomme pas" $G \
  "  { code: 'socle.abonnement.resilier', module: 'socle', horsCle: true, ecrit: true,
    roles: { proprietaire: P } }," "  { code: 'socle.abonnement.resilier', module: 'socle', horsCle: true, ecrit: true,
    roles: { proprietaire: P, administrateur: P } }," \
  "chaque rôle contre chaque geste"
prouver "« voir » qui suffit pour écrire" $PO \
  "(!ecrire && acces.includes('voir'))" "acces.includes('voir')" \
  "chaque rôle contre chaque geste"
prouver "la porte renvoie vers un membre absent" $PO \
  "where m.entreprise = \$1 and m.actif and m.roles" "where m.entreprise = \$1 and m.roles" \
  "D4 : la porte ne renvoie jamais vers une personne absente"
prouver "la porte parle d'une entreprise qu'on ne voit pas" $PO \
  "if (!voit) return" "if (false) return" \
  "D3 : une entreprise qu'on ne voit pas n'existe pas"
prouver "la porte oublie le code à mettre en place" $PO \
  "if (qui.codeAConfigurer) {" "if (false) {" \
  "un code sur le téléphone à mettre en place passe avant tout"
prouver "le serveur démarre avec une route sans geste" $A \
  "for (const r of routes) verifierDeclaration(r);" "" \
  "une route sans geste, ou avec un geste inconnu"
prouver "un geste d'entreprise sans :entreprise" $A \
  "if (parEntreprise !== r.chemin.includes(':entreprise')) {" "if (false) {" \
  "un geste d'entreprise porte :entreprise dans son chemin"
prouver "une route qui ne passe pas par la porte" $A \
  "if (!d.ok) return { statut:" "if (d.ok === 'jamais') return { statut:" \
  "un refus de rôle nomme qui peut"
prouver "une lecture sensible non tracée" $A \
  "if (d.geste.sensible && r.methode === 'GET') {" "if (false) {" \
  "une lecture de donnée sensible est tracée"
prouver "le code jugé à la connexion seulement" $A \
  "if (!qui.cle && !qui.codeAConfigurer && (await tx.query('select socle.code_manquant() m')).rows[0].m) qui.codeAConfigurer = true;" "" \
  "une session ouverte avant de devenir comptable d'un cabinet"
prouver "la trace qu'on modifie" $E \
  "create trigger audit_intouchable before update or delete on socle.audit
  for each row execute function socle.refuser_modification();" "" \
  "la trace ne se modifie pas et ne s'efface pas"
prouver "on écrit la trace d'un autre" $E \
  "utilisateur = socle.moi() and (entreprise is null" "(entreprise is null" \
  "on n'écrit pas la trace d'un autre"
prouver "tout membre lit toute la trace" $E \
  "  utilisateur = socle.moi()
  or (entreprise" "  true
  or (entreprise" \
  "chacun lit sa propre activité, et seulement la sienne"
prouver "la page suivante saute les gestes d'un même instant" $R \
  "where a.entreprise = \$1 and (a.instant, a.id) < (\$2::timestamptz, \$3::uuid) order by a.instant desc, a.id desc" "where a.entreprise = \$1 and a.instant < \$2::timestamptz and \$3::uuid is not null order by a.instant desc" \
  "lue page par page sans ligne sautée ni doublon"
prouver "le lien d'invitation gardé en clair" $R \
  "sha256(jeton), expire])" "jeton, expire])" \
  "inviter, accepter"
# socle.accepter_invitation est redéfinie par 0030 (l'équipe du cabinet) : ces trois preuves visent la
# définition EN VIGUEUR (une preuve qui vise une définition remplacée reste verte : code mort).
prouver "une invitation acceptée par une autre adresse" base/migrations/0030_cabinet_equipe.sql \
  "  if lower(v_email) <> i.email then" "  if false then" \
  "inviter, accepter"
prouver "une invitation expirée qui sert encore" base/migrations/0030_cabinet_equipe.sql \
  " or i.expire_le <= p_maintenant then" " then" \
  "une invitation expirée ne sert plus"
prouver "le propriétaire perd son rôle en acceptant une invitation" base/migrations/0030_cabinet_equipe.sql \
  "  if exists (select 1 from socle.membre where utilisateur = socle.moi() and entreprise = i.entreprise and actif and 'proprietaire' = any(roles)) then" "  if false then" \
  "le propriétaire qui accepte une invitation dans sa propre entreprise"
prouver "on change son propre rôle" $E \
  "  if m.utilisateur = socle.moi() then perform socle.refus('personne ne change son propre rôle'); end if;" "" \
  "D6 : personne ne se donne un droit"
prouver "l'administrateur change le rôle du propriétaire" $E \
  "  if 'proprietaire' = any(m.roles) then perform socle.refus('le rôle du propriétaire ne se change pas : il se transfère'); end if;" "" \
  "D6 : personne ne se donne un droit"
prouver "on retire le propriétaire" $E \
  "  if 'proprietaire' = any(m.roles) then
    perform socle.refus('on ne retire pas le propriétaire" "  if false then
    perform socle.refus('on ne retire pas le propriétaire" \
  "D6 : personne ne se donne un droit"
prouver "on s'invite soi-même" $E \
  "    perform socle.refus('personne ne s''invite soi-même');" "    null;" \
  "D6 : personne ne se donne un droit"
prouver "un transfert accepté par un autre que le destinataire" $E \
  "if not found or t.vers <> socle.moi() or" "if not found or" \
  "D4 : le transfert de propriété"
prouver "un transfert vers un ancien membre" $E \
  "  if not exists (select 1 from socle.membre where entreprise = t.entreprise and utilisateur = t.vers and actif)
     or not exists" "  if false and not exists" \
  "un transfert vers quelqu'un qui a quitté l'équipe"
prouver "un membre retiré qui garde l'accès" $E \
  "  update socle.membre set actif = false where id = p_membre;" "  update socle.membre set actif = actif where id = p_membre;" \
  "retirer un membre : son accès tombe aussitôt"

# ── Les règles datées, la numérotation et le journal inaltérable (0004) ─────────────────────────
Q=base/migrations/0004_regles_numeros_chaine.sql
J=serveur/journal.ts
prouver "la règle commune passe avant celle de l'entreprise" $Q \
  "  ) t order by t.ordre limit 1" "  ) t order by t.ordre desc limit 1" \
  "la règle de l'entreprise passe avant la commune"
prouver "une règle lue hors de ses dates" $Q \
  "     where r.code = p_code and p_date >= r.debut and (r.fin is null or p_date <= r.fin)" "     where r.code = p_code" \
  "une règle inconnue vaut « non renseigné »"
prouver "deux règles qui se chevauchent" $Q \
  ",
  constraint regle_fiscale_sans_chevauchement exclude using gist (code with =, daterange(debut, fin, '[]') with &&)" "" \
  "deux règles d'un même code ne se chevauchent jamais"
prouver "une règle qu'on réécrit" $Q \
  "create trigger regle_fiscale_intouchable before update or delete on socle.regle_fiscale
  for each row execute function socle.regle_intouchable();" "" \
  "une règle ne se réécrit pas"
prouver "un nombre à virgule dans une règle" $Q \
  "  select not jsonb_path_exists(v, 'lax \$.** ? (@.type() == \"number\" && @.floor() != @)')" "  select true" \
  "un nombre à virgule n'entre pas dans une règle"
prouver "la règle précédente jamais fermée" $Q \
  "    update socle.regle_entreprise set fin = p_debut - 1 where id = ouverte.id;" "    null;" \
  "une nouvelle règle de l'entreprise ferme la précédente la veille"
prouver "une règle qui réécrit le passé" $Q \
  "    if ouverte.debut >= p_debut then" "    if false then" \
  "une nouvelle règle de l'entreprise ferme la précédente la veille"
prouver "une caissière pose une règle" $Q \
  "    perform socle.refus('ton rôle ne permet pas de modifier les réglages fiscaux');" "    null;" \
  "seuls le propriétaire et l'administrateur posent une règle"
prouver "lpad qui coupe le millième numéro" $Q \
  "  if length(chiffres) < largeur then chiffres := lpad(chiffres, largeur, '0'); end if;" "  chiffres := lpad(chiffres, largeur, '0');" \
  "le millième numéro garde tous ses chiffres"
prouver "le numéro ne repart pas à 1 en janvier" $Q \
  "select case p_remise when 'annuelle' then extract(year from p_date)::int else 0 end" "select 0" \
  "repartent à 1 chaque année"
prouver "une reprise après des numéros donnés" $Q \
  "  if existait and c.dernier <> coalesce(c.repris, 0) then" "  if false then" \
  "une série commencée ailleurs continue"
prouver "le numéro d'une série d'une autre entreprise" $Q \
  "  if not found or s.entreprise not in (select socle.mes_entreprises()) then perform socle.refus('série introuvable'); end if;
  if not s.active" "  if not found then perform socle.refus('série introuvable'); end if;
  if not s.active" \
  "la série d'une autre entreprise est introuvable"
prouver "une caissière crée une série" $Q \
  "    perform socle.refus('ton rôle ne permet pas de créer une série de numéros');" "    null;" \
  "seuls le propriétaire et l'administrateur créent une série"
prouver "le compteur modifiable par le serveur" $Q \
  "grant select on socle.compteur to skanfact_app;" "grant select, update on socle.compteur to skanfact_app;" \
  "seuls le propriétaire et l'administrateur créent une série"
prouver "une série prise par le chemin d'une autre entreprise" $R \
  "uuid.safeParse(serie).success && (await tx.query('select 1 from socle.serie where id = \$1 and entreprise = \$2', [serie, entreprise])).rowCount === 1;" "uuid.safeParse(serie).success;" \
  "une série se touche depuis son entreprise"
prouver "une virgule acceptée par l'API" $R \
  "z.union([z.number().int(), z.string()" "z.union([z.number(), z.string()" \
  "une règle inconnue se dit « non renseignée »"
prouver "la forme canonique sans tri" $J \
  "Object.keys(o).sort().map(" "Object.keys(o).map(" \
  "la forme canonique : clés triées"
prouver "un nombre à virgule dans une pièce scellée" $J \
  "if (!Number.isSafeInteger(v)) throw" "if (!Number.isFinite(v)) throw" \
  "la forme canonique : clés triées"
prouver "la base et le serveur ne chaînent pas pareil" $Q \
  "encode(sha256(convert_to(p_precedente || p_contenu, 'UTF8')), 'hex')" "encode(sha256(convert_to(p_contenu || p_precedente, 'UTF8')), 'hex')" \
  "la base et le serveur calculent la même chaîne"
prouver "le contrôle ne relit pas les pièces" $J \
  "if (empreinteContenu(piece) !== m.contenu) return" "if (piece === 'jamais') return" \
  "une pièce modifiée après son scellé se voit"
prouver "le contrôle ne refait pas les empreintes" $Q \
  "    if m.empreinte <> socle.empreinte_maillon(m.precedente, m.contenu) then casse := m.rang; pourquoi := 'empreinte fausse'; exit; end if;" "" \
  "un maillon réécrit en base se voit"
prouver "le contrôle ne voit pas un trou" $Q \
  "    if m.rang <> attendu_rang then casse := attendu_rang; pourquoi := 'maillon manquant'; exit; end if;" "" \
  "un maillon retiré au milieu, ou à la fin, se voit"
prouver "le contrôle ne voit pas la fin retirée" $Q \
  "  if casse is null and (coalesce(c.rang, 0) <> attendu_rang or coalesce(c.derniere, repeat('0', 64)) <> attendue) then" "  if false then" \
  "un maillon retiré au milieu, ou à la fin, se voit"
prouver "le journal qu'on modifie" $Q \
  "create trigger maillon_intouchable before update or delete on socle.maillon
  for each row execute function socle.journal_intouchable();" "" \
  "le journal ne se modifie pas et ne s'efface pas"
prouver "une pièce scellée deux fois" $Q \
  ",
  -- Une pièce ne se scelle qu'une fois.
  unique (objet_type, objet_id)" "" \
  "une pièce ne se scelle qu'une fois"
prouver "sceller chez une autre entreprise" $Q \
  "  if p_entreprise not in (select socle.mes_entreprises()) then perform socle.refus('entreprise introuvable'); end if;
  insert into socle.chaine" "  insert into socle.chaine" \
  "une pièce ne se scelle qu'une fois, et jamais chez une autre entreprise"
prouver "une porte dérobée ouverte au public" $E \
  "revoke execute on function socle.code_manquant() from public;" "" \
  "chaque porte dérobée (security definer) fixe son chemin"
# Depuis 0076, code_manquant vit dans sa nouvelle définition.
prouver "une porte dérobée sans chemin fixé" base/migrations/0076_code_facultatif.sql \
  "create or replace function socle.code_manquant() returns boolean
language sql stable security definer set search_path = pg_catalog, socle as \$\$" "create or replace function socle.code_manquant() returns boolean
language sql stable security definer as \$\$" \
  "chaque porte dérobée (security definer) fixe son chemin"

# ── La file d'opérations (0005) ─────────────────────────────────────────────────────────────────
Q5=base/migrations/0005_file.sql
F=serveur/file.ts
RF=serveur/routes/file.ts
prouver "un geste reçu deux fois, refait" $F \
  "    if (deja) {" "    if (deja && false) {" \
  "un geste envoyé deux fois ne compte qu'une fois"
prouver "un trou dans la file, accepté" $F \
  "    if (op.ordre > dernier + 1) return" "    if (false) return" \
  "un trou arrête la file et dit lequel manque"
prouver "des gestes rejoués dans l'ordre d'arrivée" $F \
  "[...operations].sort((a, b) => a.ordre - b.ordre)" "[...operations]" \
  "un trou arrête la file et dit lequel manque"
prouver "la base accepte n'importe quel numéro d'ordre" $Q5 \
  "  if p_ordre <> dernier + 1 then perform socle.refus(format('l''opération attendue porte le numéro %s', dernier + 1)); end if;" "" \
  "la base elle-même refuse un numéro d'ordre qui n'est pas le suivant"
prouver "la file d'un autre appareil" $Q5 \
  "where a.id = p_appareil and a.utilisateur = socle.moi() and a.revoque_le is null" "where a.id = p_appareil" \
  "la base elle-même refuse un numéro d'ordre qui n'est pas le suivant"
prouver "un geste de la file qui ne passe pas par la porte" $F \
  "    if (!d.ok) return nonAccepte(" "    if (d.ok === 'jamais') return nonAccepte(" \
  "un geste refusé par la porte va dans « À reprendre »"
prouver "un fait refusé" $F \
  "t?.fait ? 'en_attente_decision' : 'refusee'" "'refusee'" \
  "un fait n'est jamais refusé"
prouver "une mise de côté qui laisse son travail" $F \
  "        await tx.query('rollback to savepoint geste');" "" \
  "un geste mis de côté ne laisse rien derrière lui"
prouver "une erreur du serveur qui n'arrête pas la file" $F \
  "if (r.statut === 'manquante' || r.statut === 'erreur') break;" "if (r.statut === 'manquante') break;" \
  "une erreur du serveur n'avale pas le geste"
prouver "un geste illisible traité quand même" $F \
  "    if (!charge.success) {" "    if (charge.success === 'jamais') {" \
  "un geste illisible, d'un format inconnu"
prouver "un format inconnu lu quand même" $F \
  "    if (!t.formats.includes(op.format)) return" "    if (false) return" \
  "un geste illisible, d'un format inconnu"
prouver "l'horloge d'un poste jamais signalée" $Q5 \
  "  ecart := abs(extract(epoch from (now() - p_instant_poste))) > 300;" "  ecart := false;" \
  "une horloge de poste qui s'écarte de plus de 5 minutes"
prouver "l'identifiant d'un autre appareil réutilisé" $F \
  "      if (deja.appareil !== appareil) return" "      if (false) return" \
  "l'identifiant d'un geste d'un autre appareil"
prouver "une ligne reprise deux fois" $Q5 \
  "  if o.resolue_le is not null then perform socle.refus('cette opération a déjà été reprise'); end if;" "" \
  "ne se vide que par un geste"
prouver "un étranger vide « À reprendre »" $Q5 \
  "  if not found or not (o.utilisateur = socle.moi()" "  if not found or false and not (o.utilisateur = socle.moi()" \
  "ne se vide que par un geste"
prouver "« À reprendre » montré à tous les membres" $Q5 \
  "      and socle.mes_roles(entreprise) && array['proprietaire', 'administrateur']::text[]));
grant select on socle.operation" "      and true));
grant select on socle.operation" \
  "un geste refusé par la porte va dans « À reprendre »"
prouver "une opération reçue qu'on réécrit" $Q5 \
  "create trigger operation_intouchable before update or delete on socle.operation
  for each row execute function socle.operation_intouchable();" "" \
  "une opération reçue ne se modifie pas"
prouver "un traitement fantôme au démarrage" $RF \
  "    if (!GESTES.has(g)) throw" "    if (false) throw" \
  "le serveur ne démarre pas avec un traitement dont la porte ignore le geste"
prouver "un geste de module qui en remplace un autre" serveur/porte/gestes.ts \
  "    if (GESTES.has(g.code)) throw" "    if (false) throw" \
  "un geste déjà déclaré ne se remplace pas"

# ── Le moteur : le calcul d'une pièce, en entiers, et le banc v10 ────────────────────────────────
MA=moteur/argent.ts
MP=moteur/piece.ts
prouver "une moitié arrondie vers le bas" $MA \
  "  if (2n * (r < 0n ? -r : r) >= d) return" "  if (2n * (r < 0n ? -r : r) > d) return" \
  "au plus proche, la moitié s'éloigne de zéro"
prouver "une moitié négative arrondie vers le haut" $MA \
  "return n < 0n ? q - 1n : q + 1n;" "return q + 1n;" \
  "au plus proche, la moitié s'éloigne de zéro"
prouver "des zéros en trop qui multiplient le nombre" $MA \
  "BigInt(entiers + fraction.slice(0, decimales).padEnd(decimales, '0'))" "BigInt(entiers + fraction.padEnd(decimales, '0'))" \
  "un nombre écrit se lit exactement"
prouver "un nombre tronqué en silence" $MA \
  "  if (fraction.replace(/0+\$/, '').length > decimales) throw" "  if (false) throw" \
  "un nombre écrit se lit exactement"
prouver "la remise portée sur la déduction d'acompte" $MP \
  "const remisable = lignes.filter((l) => !l.sansRemise).reduce((t, l) => t + l.ht, 0n);" "const remisable = lignes.filter(() => true).reduce((t, l) => t + l.ht, 0n);" \
  "la remise globale ne porte pas sur la déduction d'un acompte"
prouver "la TVA calculée avant la remise" $MP \
  "    const base = l.sansRemise || remisable <= 0n ? l.ht : diviserArrondi(l.ht * (remisable - remise), remisable);" "    const base = l.ht;" \
  "un devis n'a pas de timbre ; la remise globale réduit la base de TVA"
prouver "la TVA d'un taux arrondie ligne par ligne (et non en cumul comme la v10)" $MP \
  "    t.tva = diviserArrondi(t.tva * MILLION + base * l.tauxTva, MILLION);" "    t.tva += auTaux(base, l.tauxTva);" \
  "un demi-millime EXACT s'arrondit loin de zéro"
prouver "le timbre d'office sur un avoir" $MP \
  "|| ((p.type === 'avoir' || p.type === 'proforma') && p.appliquerTimbre === true);" "|| p.type === 'avoir' || (p.type === 'proforma' && p.appliquerTimbre === true);" \
  "le timbre : d'office sur une facture"
prouver "le timbre en dinars ajouté tel quel à une pièce en euros" $MP \
  "    : p.cours ? diviserArrondi(p.timbre * MILLION * s, MILLE * p.cours)" "    : false ? 0n" \
  "une pièce en euros se calcule au centime"
prouver "la retenue calculée sur le timbre aussi" $MP \
  "  const retenue = auTaux(netHT + totalTVA, tauxRetenue);" "  const retenue = auTaux(netHT + totalTVA + timbre, tauxRetenue);" \
  "la retenue à la source porte sur le TTC hors timbre"
prouver "une retenue sur un devis" $MP \
  "RETENUE_POSSIBLE.includes(p.type) ? (p.tauxRetenue ?? 0n) : 0n" "(p.tauxRetenue ?? 0n)" \
  "la retenue à la source porte sur le TTC hors timbre"
prouver "une pièce en euros calculée au millime" $MA \
  "export const echelle = (d: Devise): bigint => 10n ** BigInt(d.decimales);" "export const echelle = (_d: Devise): bigint => 1000n;" \
  "une pièce en euros se calcule au centime"
prouver "le timbre déclaré dans la devise de la pièce" $MP \
  "    timbreBase: applique ? p.timbre : 0n," "    timbreBase: timbre," \
  "une pièce en euros se calcule au centime"
# Les prix de l'exemple de cinq ans ne demandent jamais d'arrondir une ligne : c'est le tirage qui
# voit ce défaut-là (une preuve restée verte sur l'exemple, le 28/09/2026).
prouver "une ligne tronquée au lieu d'être arrondie (vue par le banc)" $MP \
  "    const ht = diviserArrondi(l.quantite * l.prixUnitaire * s, MILLE * MILLION);" "    const ht = (l.quantite * l.prixUnitaire * s) / (MILLE * MILLION);" \
  "20 000 pièces tirées au hasard"
prouver "le timbre d'office sur un avoir (vu par l'exemple de cinq ans)" $MP \
  "|| ((p.type === 'avoir' || p.type === 'proforma') && p.appliquerTimbre === true);" "|| p.type === 'avoir' || (p.type === 'proforma' && p.appliquerTimbre === true);" \
  "les pièces de l'exemple de cinq ans tombent sur le même millime"
prouver "un écart tranché qui a disparu reste dans la liste" tests/moteur/banc-v10.test.ts \
  "  [9418, " "  [9419, " \
  "20 000 pièces tirées au hasard"

# ── Les tiers et la facture de vente, jusqu'à l'émission (0006, serveur/ventes) ─────────────────
Q6=base/migrations/0006_tiers_et_ventes.sql
VP=serveur/ventes/pieces.ts
VR=serveur/ventes/routes.ts
prouver "une facture émise qu'on modifie" $Q6 \
  "create trigger piece_scellee before update or delete on ventes.piece
  for each row execute function ventes.piece_scellee();" "" \
  "une facture émise ne se modifie plus et ne s'efface jamais"
prouver "les lignes d'une facture émise qu'on modifie" $Q6 \
  "  if exists (select 1 from ventes.piece x where x.id = p and x.statut <> 'brouillon') then" "  if false then" \
  "une facture émise ne se modifie plus et ne s'efface jamais"
prouver "le client d'une autre entreprise sur une pièce" $Q6 \
  "create trigger tiers_de_l_entreprise before insert or update on ventes.piece
  for each row execute function ventes.tiers_de_l_entreprise();" "" \
  "le client d'une autre entreprise ne sert pas"
prouver "une série annuelle sans l'année, acceptée par la base" $Q6 \
  "alter table socle.serie add constraint serie_annuelle_ecrit_l_annee check (remise <> 'annuelle' or format like '%{AAAA}%');" "" \
  "une série qui repart à 1 chaque année écrit l'année"
prouver "une série annuelle sans l'année, acceptée par l'API" serveur/routes/socle.ts \
  "(c.format ?? '{AAAA}').includes('{AAAA}')" "true" \
  "une série qui repart à 1 chaque année écrit l'année"
prouver "une facture émise sans timbre renseigné" $VP \
  "  if (calcul.timbreManquant) {" "  if (calcul.timbreManquant === 'jamais') {" \
  "le contrôle passe avant le numéro"
prouver "une facture émise deux fois" $VP \
  "  if (p.statut !== 'brouillon') throw new Refus('ventes.deja_emise');" "" \
  "une facture déjà émise ne s'émet pas une seconde fois"
prouver "un refus sans le bouton qui débloque" $VP \
  "throw new Refus('ventes.sans_serie', { bouton: 'socle.reglages_fiscaux.modifier' });" "throw new Refus('ventes.sans_serie');" \
  "sans série de factures, l'émission est refusée et le refus dit où la créer"
prouver "une facture émise recalculée à la lecture" $VP \
  "  if (p.totaux && p.tva_par_taux) {" "  if (p.totaux === 'jamais' && p.tva_par_taux) {" \
  "une facture émise garde son timbre et sa copie"
prouver "le scellé qui ne couvre pas les montants des lignes" $VP \
  "contenuScelle(emise, lignesEmises)" "contenuScelle(emise, lignes)" \
  "la chaîne des factures se contrôle en relisant les pièces"
prouver "la retenue perdue en chemin (vue par J1)" $VP \
  "    taux_retenue: b.tauxRetenue === undefined ? 0n : depuisTexte(b.tauxRetenue, DECIMALES.taux)," "    taux_retenue: 0n," \
  "chaque facture émise porte, au millime, les montants de la v10"
prouver "un brouillon écrasé malgré sa révision" $VP \
  "  if (p.revision !== revisionVue) throw new Perimee();" "" \
  "un brouillon modifié entre-temps n'est pas écrasé"
prouver "un brouillon supprimé sans trace" $VP \
  "  await tracer(tx, entreprise, 'ventes.brouillon.supprimer'" "  if (id === 'jamais') await tracer(tx, entreprise, 'ventes.brouillon.supprimer'" \
  "supprimer un brouillon laisse sa trace"
prouver "un caissier qui crée des brouillons de vente" serveur/ventes/gestes.ts \
  "    roles: { proprietaire: 'oui', administrateur: 'oui', commercial: 'oui' } },
  { code: 'ventes.facture.emettre'" "    roles: { proprietaire: 'oui', administrateur: 'oui', commercial: 'oui', caissier: 'oui' } },
  { code: 'ventes.facture.emettre'" \
  "les rôles : un caissier ne crée pas de brouillon de vente"
prouver "une pièce en devise sans cours" $VR \
  "}).refine((b) => b.devise === undefined || b.devise === 'TND' || b.cours !== undefined," "}).refine(() => true," \
  "une pièce en devise porte son cours"
prouver "une date de pièce lue comme un instant" serveur/base.ts \
  "pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v);" "" \
  "J1 en petit"

# ── Les requêtes écrites avec Kysely (base/types.ts, serveur/base.ts) ─────────────────────────────
prouver "des types de la base qui ne suivent plus les migrations" base/types.ts \
  "    net_a_payer: bigint | null;" "    net_a_payer: number | null;" \
  "base/types.ts suit les migrations"
prouver "un type de colonne inconnu qui devient « unknown » en silence" base/generer-types.ts \
  "    if (!ts) throw new Error(" "    if (ts === 'jamais') throw new Error(" \
  "un type de colonne que le générateur ne connaît pas"
prouver "un entier de 64 bits lu en texte" serveur/base.ts \
  "pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => BigInt(v));" "" \
  "un entier de 64 bits se lit en bigint"
prouver "des requêtes qui servent encore après leur transaction" serveur/base.ts \
  "        if (enCours.get(tx) !== jeton) throw new Error('requête après la fin de sa transaction : refusée');" "" \
  "des requêtes gardées après leur transaction refusent de servir"
prouver "des requêtes hors de enTantQue" serveur/base.ts \
  "  if (!jeton) throw new Error('requetes() s\\'emploie dans une transaction ouverte par enTantQue');" "" \
  "hors d'une transaction ouverte par enTantQue, pas de requêtes"
prouver "un grand entier qui casse la réponse de l'API" serveur/app.ts \
  "  app.setReplySerializer(" "  void (" \
  "la chaîne des factures se contrôle en relisant les pièces"

# ── Exporter et restaurer une entreprise (base/entreprise.ts) ────────────────────────────────────
EX=base/entreprise.ts
prouver "une table nouvelle exportée sans décision" $EX \
  "    if (manquantes.length) throw" "    if (manquantes.length === -1) throw" \
  "une table nouvelle que personne n'a rangée arrête l'export"
prouver "l'empreinte du mot de passe dans l'export" $EX \
  "  'socle.utilisateur': { classe: 'reference', colonnes: ['id', 'email', 'nom', 'langue', 'cree_le'] }," "  'socle.utilisateur': { classe: 'reference', colonnes: ['id', 'email', 'nom', 'langue', 'cree_le', 'empreinte_mot_de_passe'] }," \
  "aucun secret de connexion"
prouver "les factures de la voisine dans l'export" $EX \
  "  'ventes.piece': { classe: 'entreprise' }," "  'ventes.piece': { classe: 'entreprise', condition: 'true' }," \
  "l'export ne porte rien de la voisine"
prouver "un fichier abîmé accepté" $EX \
  "  if (fin.fin !== true || fin.empreinte !== empreinte(lignes.slice(0, -1))) {" "  if (fin.fin !== true) {" \
  "un fichier coupé ou abîmé est refusé"
prouver "une base aux migrations différentes acceptée" $EX \
  "      throw new Error('la base cible n\\'a pas les mêmes migrations" "      if (Date.now() < 0) throw new Error('la base cible n\\'a pas les mêmes migrations" \
  "un fichier coupé ou abîmé est refusé"
prouver "une restauration par-dessus l'entreprise" $EX \
  "      throw new Error('cette entreprise existe déjà" "      if (Date.now() < 0) throw new Error('cette entreprise existe déjà" \
  "restaurée dans une base vide"
prouver "un lien qui mène nulle part accepté" $EX \
  "      if (pendantes) throw" "      if (pendantes === -1) throw" \
  "un lien qui mène nulle part annule tout"
prouver "les règles du métier qui refusent de reposer une facture émise" $EX \
  "    await client.query('set local session_replication_role = replica');" "" \
  "restaurée dans une base vide"
prouver "une restauration sans trace" $EX \
  "    await client.query(\`insert into socle.audit (entreprise, geste, objet_type, objet_id, apres)" "    if (Date.now() < 0) await client.query(\`insert into socle.audit (entreprise, geste, objet_type, objet_id, apres)" \
  "restaurée dans une base vide"
prouver "les lignes relues en JavaScript (un grand entier y perd un chiffre)" $EX \
  "      lignes.push(JSON.stringify(entete), r.lignes);" "      lignes.push(JSON.stringify(entete), JSON.stringify(JSON.parse(r.lignes)));" \
  "restaurée dans une base vide"
prouver "un collaborateur du cabinet oublié (vide comparé à une entreprise)" $EX \
  "and (\${c.condition ?? 'entreprise = \$1'}) is not true\`;" "and not (\${c.condition ?? 'entreprise = \$1'})\`;" \
  "restaurée dans une base vide"
prouver "J1 : un export qui s'arrête en route (272 lignes par table au plus)" $EX \
  "'[]')::text lignes from (\${p.selection}) t\`;" "'[]')::text lignes from (\${p.selection} limit 272) t\`;" \
  "l'autre moitié de J1"
prouver "J1 : les factures d'une entreprise visibles par sa voisine" base/migrations/0006_tiers_et_ventes.sql \
  "create policy visible on ventes.piece using (entreprise in (select socle.mes_entreprises()));" "create policy visible on ventes.piece using (true);" \
  "le propriétaire de la voisine ne lit rien de l'entreprise"

# ── Le catalogue des textes (textes/, serveur) ─────────────────────────────────────────────────
prouver "une phrase écrite en dur dans le serveur" serveur/ventes/pieces.ts \
  "avertissement: motif('ventes.avertissement_timbre')" "avertissement: 'le timbre fiscal manque'" \
  "aucune phrase n'est écrite en dur dans le code du serveur"
prouver "une phrase de la base oubliée au catalogue" textes/base.ts \
  "  { base: 'membre introuvable', cle: 'base.equipe.membre_introuvable', fr: 'membre introuvable' }," "" \
  "chaque phrase de la base est au catalogue"
prouver "une clé employée mais jamais déclarée" serveur/ventes/textes.ts \
  "  'ventes.deja_emise': 'cette facture est déjà émise'," "" \
  "chaque clé employée par le code est déclarée"
prouver "un geste sans son texte au catalogue" serveur/porte/gestes.ts \
  "    if (!texteConnu(\`geste.\${g.code}\`)) throw" "    if (g.code === 'jamais') throw" \
  "chaque clé employée par le code est déclarée"
prouver "une clé qui change de phrase en cours de route" textes/textes.ts \
  "    if (deja !== undefined && deja !== fr) throw" "    if (deja === 'jamais') throw" \
  "chaque clé employée par le code est déclarée"
prouver "une langue factice qui ne rallonge pas" textes/textes.ts \
  "  const manque = Math.ceil(longueur * 0.4) + 2;" "  const manque = 2;" \
  "la langue factice est 40 % plus longue"
prouver "un refus de la base rendu tel quel, sans le catalogue" serveur/erreurs.ts \
  "  const reconnu = reconnaitre(e.message ?? '');" "  const reconnu = e.message === 'jamais' ? reconnaitre(e.message) : null;" \
  "un refus du serveur, un refus de la base et un champ qui ne va pas passent par le catalogue"
prouver "un champ qui ne va pas, dit en anglais par la bibliothèque" serveur/app.ts \
  "const pourquoi = p ? raison(p, requete.body) : motif('champ.valeur');" "const pourquoi = p ? p.message : motif('champ.valeur');" \
  "un refus du serveur, un refus de la base et un champ qui ne va pas passent par le catalogue"

# ── Les clés de l'API, /v1 et la documentation (0007, serveur/cles.ts) ─────────────────────────
Q7=base/migrations/0007_cles_api.sql
prouver "une clé révoquée ou expirée qui voit encore son entreprise" $Q7 \
  "   where k.id = socle.ma_cle() and k.revoquee_le is null and k.expire_le > now()" "   where k.id = socle.ma_cle()" \
  "révoquée ou expirée, une clé ne sert plus à rien"
prouver "une clé révoquée ou expirée reconnue par le serveur" $Q7 \
  "   where k.empreinte = p_empreinte and k.revoquee_le is null and k.expire_le > now()" "   where k.empreinte = p_empreinte" \
  "révoquée ou expirée, une clé ne sert plus à rien"
prouver "une clé qui fait tous les gestes, pas seulement les siens" serveur/porte/porte.ts \
  "    if (!geste.horsCle && qui.cle.gestes.includes(geste.code)) return" "    if (!geste.horsCle) return" \
  "une clé fait ses gestes dans son entreprise"
prouver "une clé à qui l'on donne ce qui gouverne l'entreprise" serveur/cles.ts \
  "    if (g.horsCle) throw" "    if (code === 'jamais') throw" \
  "personne ne donne à une clé un droit qu'il n'a pas"
prouver "une clé qui reçoit un droit que son créateur n'a pas" serveur/cles.ts \
  "    if (!d.ok || (g.ecrit && d.lectureSeule)) throw" "    if (code === 'jamais') throw" \
  "personne ne donne à une clé un droit qu'il n'a pas"
prouver "une clé qui agit comme une personne (son compte)" serveur/app.ts \
  "        if (qui.cle && !GESTES.has(r.geste)) return" "        if (qui.cle && r.geste === 'jamais') return" \
  "une clé fait ses gestes dans son entreprise"
prouver "une clé qui agit au nom de son créateur (et voit tout ce qu'il voit)" serveur/app.ts \
  "enTantQue(ctx.pool, qui.cle ? null : qui.utilisateur, async (tx) => {|||          }, qui.cle?.id ?? null);" "enTantQue(ctx.pool, qui.utilisateur, async (tx) => {|||          });" \
  "une clé fait ses gestes dans son entreprise"
prouver "la clé gardée par la connexion" serveur/base.ts \
  "\$2, true)" "\$2, false)" \
  "une connexion rendue au pool ne garde jamais la clé précédente"
prouver "une trace qui oublie la clé" $Q7 \
  "  values (p_entreprise, socle.moi(), socle.ma_cle(), p_geste," "  values (p_entreprise, socle.moi(), null, p_geste," \
  "une clé fait ses gestes dans son entreprise"
prouver "l'empreinte des clés lisible par le serveur" $Q7 \
  "grant select (id, entreprise, nom, prefixe, gestes, cree_par, cree_le, expire_le, revoquee_le, revoquee_par, derniere_utilisation)
  on socle.cle_api to skanfact_app;" "grant select on socle.cle_api to skanfact_app;" \
  "une clé ne se montre qu'une fois"
prouver "les clés visibles par toute l'équipe" $Q7 \
  "  using (entreprise in (select socle.mes_entreprises()) and socle.mes_roles(entreprise) && array['proprietaire', 'administrateur']);" "  using (entreprise in (select socle.mes_entreprises()));" \
  "personne ne donne à une clé un droit qu'il n'a pas"
prouver "une documentation qui oublie le corps attendu" serveur/app.ts \
  "        ...(r.corps ? { requestBody:" "        ...(r.corps === 'jamais' ? { requestBody:" \
  "décrit chaque route depuis le code"
prouver "« de » jamais élidé" textes/textes.ts \
  "    return de ? (ELISION.test(valeur) ? \`d'\${valeur}\` : \`de \${valeur}\`) : valeur;" "    return de ? \`de \${valeur}\` : valeur;" \
  "s'élide devant une voyelle"

# ── Le moteur d'écritures : l'écriture d'une facture de vente (moteur/ecritures.ts) ─────────────
ME=moteur/ecritures.ts
prouver "l'écart d'une remise répartie mis au change au lieu de la plus grosse base" $ME \
  "    if (piece.devise.code === base.code) {" "    if (piece.devise.code === 'jamais') {" \
  "le chiffre d'affaires est le net HT"
prouver "l'écart de conversion versé dans le chiffre d'affaires" $ME \
  "    } else ecartConversion = ecart;" "    } else bases.set(taux[0] ?? 0n, (bases.get(taux[0] ?? 0n) ?? 0n) + ecart);" \
  "10 000 factures tirées au hasard"
prouver "un gain de change écrit en perte" $ME \
  "  if (ecartConversion > 0n) poser(comptes.gainsChange, 'change', ecartConversion, 'credit');" "  if (ecartConversion > 0n) poser(comptes.pertesChange, 'change', ecartConversion, 'credit');" \
  "l'écart de conversion va au change"
prouver "une conversion tronquée au lieu d'arrondie" $ME \
  "diviserArrondi(montant * cours, 10n ** BigInt(exposant))" "(montant * cours) / 10n ** BigInt(exposant)" \
  "la conversion d'un montant en devise arrondit au millime le plus proche"
prouver "un montant négatif gardé dans sa colonne" $ME \
  "    const auDebit = (sens === 'debit') === (montant > 0n);" "    const auDebit = sens === 'debit';" \
  "10 000 factures tirées au hasard"
prouver "le timbre reconverti depuis la devise (1,002 DT)" $ME \
  "  const timbre = t.timbreBase * signe;" "  const timbre = conv(t.timbre);" \
  "10 000 factures tirées au hasard"
prouver "le client débité du net après retenue au lieu du brut" $ME \
  "  const ttc = conv(t.totalTTC);" "  const ttc = conv(t.netAPayer);" \
  "chaque facture de l'exemple de cinq ans s'écrit au même millime"
prouver "une ligne à zéro écrite" $ME \
  "    if (montant === 0n) return;" "" \
  "jamais une ligne à zéro"
prouver "un écart tranché des écritures qui a disparu reste dans la liste" tests/moteur/ecritures-v10.test.ts \
  "  [2811, 'suite de" "  [2812, 'suite de" \
  "10 000 factures tirées au hasard"

# ── Les règlements d'une facture de vente (moteur/reglements.ts) ────────────────────────────────
MR=moteur/reglements.ts
prouver "les règlements pris dans l'ordre de saisie, pas des dates" $MR \
  "  evenements.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || " "  evenements.sort((a, b) => " \
  "chaque règlement opère sa part au prorata"
prouver "les règlements pris dans l'ordre de saisie (vu par le banc)" $MR \
  "  evenements.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || " "  evenements.sort((a, b) => " \
  "5 000 factures tirées au hasard"
prouver "le même jour, le règlement passe avant l'avoir" $MR \
  "(a.lie === b.lie ? a.i - b.i : a.lie ? -1 : 1)" "(a.lie === b.lie ? a.i - b.i : a.lie ? 1 : -1)" \
  "un avoir posé après un règlement régularise à SA date"
prouver "celui qui solde ne prend pas le reste (prorata au-delà du dû)" $MR \
  "    return cumul >= netDu ? due : diviserArrondi(due * cumul, netDu);" "    return netDu === 0n ? due : diviserArrondi(due * cumul, netDu);" \
  "parts et régularisations font la retenue née"
prouver "une retenue née sans rien de versé" $MR \
  "    if (due === 0n || cumul <= 0n) return 0n;" "    if (due === 0n) return 0n;" \
  "parts et régularisations font la retenue née"
prouver "la part d'un règlement tronquée au lieu d'arrondie" $MR \
  "diviserArrondi(due * cumul, netDu);" "(due * cumul) / netDu;" \
  "chaque règlement opère sa part au prorata"
prouver "un avoir après un règlement ne régularise rien" $MR \
  "    else if (d !== 0n) ajustements.set(" "    else if (d !== 0n && x.date === '') ajustements.set(" \
  "un avoir posé après un règlement régularise à SA date"
prouver "une même devise convertie par le dinar" $ME \
  "  if (source.devise.code === cible.devise.code) return montant;" "" \
  "passe par le dinar et s'arrondit"
prouver "une facture annulée doit encore quelque chose" $MR \
  "reste: annulee ? 0n : netAPayer - credite - paye" "reste: netAPayer - credite - paye" \
  "le statut s'en déduit"
prouver "des avoirs qui couvrent la facture la disent payée" $MR \
  "netAPayer > 0n && solde.credite >= netAPayer ? 'annulee' : 'payee'" "false ? 'annulee' : 'payee'" \
  "le statut s'en déduit"
prouver "en retard le jour même de l'échéance" $MR \
  "  if (echeance && echeance < aujourdhui) return 'en_retard';" "  if (echeance && echeance <= aujourdhui) return 'en_retard';" \
  "le statut s'en déduit"
prouver "le client soldé au cours du jour (le change disparaît)" $MR \
  "  const solde = versLaBase(reglement.montant, piece.devise, piece.cours, base);" "  const solde = versLaBase(reglement.montant, piece.devise, coursDuJour, base);" \
  "l'écart est du change"
prouver "le client soldé au cours du jour (vu par le banc)" $MR \
  "  const solde = versLaBase(reglement.montant, piece.devise, piece.cours, base);" "  const solde = versLaBase(reglement.montant, piece.devise, coursDuJour, base);" \
  "5 000 factures tirées au hasard"
prouver "un gain de change écrit en perte, à l'encaissement" $MR \
  "  if (ecart > 0n) poser(comptes.gainsChange, 'change', ecart, 'credit');" "  if (ecart > 0n) poser(comptes.pertesChange, 'change', ecart, 'credit');" \
  "l'écart est du change"
prouver "un remboursement gardé dans la colonne d'un encaissement" $MR \
  "    const auDebit = (sens === 'debit') === (montant > 0n);" "    const auDebit = sens === 'debit';" \
  "un remboursement change chaque ligne de colonne"
prouver "la retenue rendue au client au lieu de naître à l'encaissement" $MR \
  "  poser(comptes.retenueSubie, 'retenue', retenue, 'debit');" "  poser(comptes.retenueSubie, 'retenue', retenue, 'credit');" \
  "la retenue naît ici"
prouver "le banc qui relit 7 700,677 € comme 7 700,68 €" tests/moteur/v10.ts \
  "  if (m) return (m[1]?.length ?? 0) > dec ? null : BigInt(Math.round(v * 10 ** dec));|||  return Math.abs(e - r) > 1e-9 ? null : BigInt(r);" "|||  return Math.abs(e - r) > 1e-6 * Math.max(1, Math.abs(e)) ? null : BigInt(r);" \
  "5 000 factures tirées au hasard"

# ── L'écriture d'un avoir de vente (moteur/ecritures.ts) ────────────────────────────────────────
prouver "un avoir écrit dans le sens d'une facture" $ME \
  "  const signe = piece.type === 'avoir' ? -1n : 1n;" "  const signe = 1n;" \
  "un avoir libre s'écrit à l'envers"
prouver "le timbre d'un avoir gardé dans le sens d'une facture" $ME \
  "  const timbre = t.timbreBase * signe;" "  const timbre = t.timbreBase;" \
  "l'avoir libre est le miroir exact de la facture identique"
prouver "un avoir crédite le client à son propre cours" $ME \
  "      deltaChange = versLaBase(dansLaDeviseDe(natif, piece, f, base), f.devise, f.cours, base) - versLaBase(natif, piece.devise, piece.cours, base);" "" \
  "rattaché à une facture d'un autre cours"
prouver "un avoir crédite le client à son propre cours (vu par le banc)" $ME \
  "      deltaChange = versLaBase(dansLaDeviseDe(natif, piece, f, base), f.devise, f.cours, base) - versLaBase(natif, piece.devise, piece.cours, base);" "" \
  "5 000 avoirs tirés au hasard"
prouver "un avoir d'une autre devise compté sans conversion" $ME \
  "versLaBase(dansLaDeviseDe(natif, piece, f, base), f.devise" "versLaBase(natif, f.devise" \
  "5 000 avoirs tirés au hasard"
prouver "le gain de change d'un avoir contre-passé en perte" $ME \
  "  if (deltaChange > 0n) poser(comptes.gainsChange, 'change', deltaChange, 'credit');" "  if (deltaChange > 0n) poser(comptes.pertesChange, 'change', -deltaChange, 'debit');" \
  "rattaché à une facture d'un autre cours"
prouver "un avoir après un règlement ne régularise pas la retenue" $ME \
  "  if (piece.type === 'avoir' && rattachement && rattachement.regularisationRetenue !== 0n) {" "  if (false) {" \
  "posé après un règlement, il régularise"
prouver "la régularisation convertie au cours de l'avoir" $ME \
  "    const b = versLaBase(rattachement.regularisationRetenue, rattachement.facture.devise, rattachement.facture.cours, base);" "    const b = versLaBase(rattachement.regularisationRetenue, piece.devise, piece.cours, base);" \
  "5 000 avoirs tirés au hasard"

# ── Le calcul d'un achat (moteur/achats.ts) ─────────────────────────────────────────────────────
MA=moteur/achats.ts
prouver "une ligne d'achat tronquée au lieu d'arrondie" $MA \
  "    const ht = diviserArrondi(l.quantite * l.prixUnitaire * s, MILLE * MILLION);" "    const ht = (l.quantite * l.prixUnitaire * s) / (MILLE * MILLION);" \
  "20 000 achats tirés au hasard"
prouver "la TVA d'une entreprise non assujettie déduite" $MA \
  "deductible: a.tvaRecuperable && !l.nonDeductible" "deductible: !l.nonDeductible" \
  "une entreprise non assujettie n'en déduit aucune"
prouver "la TVA d'une entreprise non assujettie déduite (vu par le banc)" $MA \
  "deductible: a.tvaRecuperable && !l.nonDeductible" "deductible: !l.nonDeductible" \
  "20 000 achats tirés au hasard"
prouver "un avoir fournisseur qui ajoute au lieu de retirer" $MA \
  "  const sens = a.nature === 'avoir' ? -1n : 1n;" "  const sens = 1n;" \
  "un avoir retire et un acompte n'est pas une charge"
prouver "un acompte compté en charge" $MA \
  "    b.parDestination[k] = avance ? 0n : conv(parDestination[k]);" "    b.parDestination[k] = conv(parDestination[k]);" \
  "un avoir retire et un acompte n'est pas une charge"
prouver "les frais d'un acompte comptés deux fois" $MA \
  "frais: avance ? 0n : conv(frais)," "frais: conv(frais)," \
  "20 000 achats tirés au hasard"
prouver "l'avance d'un acompte sans ses frais" $MA \
  "      avance: avance ? conv(totalHT + frais) : 0n," "      avance: avance ? conv(totalHT) : 0n," \
  "un avoir retire et un acompte n'est pas une charge"
prouver "la retenue d'un achat calculée sur les frais" $MA \
  "  const retenue = auTaux(totalHT + totalTVA, a.tauxRetenue ?? 0n);" "  const retenue = auTaux(totalTTC, a.tauxRetenue ?? 0n);" \
  "la retenue porte sur le TTC hors frais"
prouver "la TVA non déductible oubliée dans le coût" $MA \
  "    b.cout[k] = b.parDestination[k] + b.nonDeductibleParDestination[k];" "    b.cout[k] = b.parDestination[k];" \
  "chaque achat de l'exemple de cinq ans se calcule"
prouver "un achat en devise laissé dans sa devise" $MA \
  "  const conv = (v: bigint) => sens * versLaBase(v, a.devise, a.cours, base);" "  const conv = (v: bigint) => sens * v;" \
  "chaque achat de l'exemple de cinq ans se calcule"

# ── L'écriture d'un achat et l'imputation d'un acompte (moteur/achats.ts) ───────────────────────
prouver "la TVA non déductible toujours passée en charge" $MA \
  "  else for (const k of DESTINATIONS) poser(compteDe[k], 'achat', b.nonDeductibleParDestination[k], 'debit');" "  else for (const k of DESTINATIONS) poser(comptes.charges, 'achat', b.nonDeductibleParDestination[k], 'debit');" \
  "jusqu'à l'immobilisation"
prouver "la TVA non récupérable d'un acompte passée en charge" $MA \
  "  if (achat.nature === 'acompte') poser(comptes.avancesFournisseurs, 'avance', b.totalTVA - b.tvaDeductible, 'debit');" "  if (achat.nature === 'acompte') poser(comptes.charges, 'achat', b.totalTVA - b.tvaDeductible, 'debit');" \
  "un acompte va aux avances"
prouver "le fournisseur crédité du net (la retenue née à la facture)" $MA \
  "  poser(comptes.fournisseurs, 'fournisseur', b.netAPayer + b.retenue - delta, 'credit');" "  poser(comptes.fournisseurs, 'fournisseur', b.netAPayer - delta, 'credit');" \
  "chaque achat de l'exemple de cinq ans s'écrit au même millime"
prouver "l'écart de cours d'un avoir fournisseur dans le mauvais sens" $MA \
  "  poser(comptes.fournisseurs, 'fournisseur', b.netAPayer + b.retenue - delta, 'credit');" "  poser(comptes.fournisseurs, 'fournisseur', b.netAPayer + b.retenue + delta, 'credit');" \
  "rattaché, il règle le fournisseur au cours de la facture"
prouver "un avoir fournisseur ne régularise pas la retenue" $MA \
  "  if (avoirRattache && avoirRattache.regularisationRetenue !== 0n) {" "  if (false) {" \
  "rattaché, il règle le fournisseur au cours de la facture"
prouver "l'écart de conversion d'un achat avalé par la première ligne" $MA \
  "    // Le débit dépasse : il manque un crédit, un gain ; l'inverse, une perte.
    if (ecart > 0n) poser(comptes.gainsChange, 'change', ecart, 'credit');
    else poser(comptes.pertesChange, 'change', -ecart, 'debit');" "    { const l = lignes[0]; if (l) { if (l.debit > 0n) l.debit -= ecart; else l.credit += ecart; } }" \
  "jamais avalé par une autre ligne"
prouver "un acompte imputé à son propre cours" $MA \
  "  const delta = ecartDeCours(acompte, facture, ta.netAPayer + ta.retenue, base);" "  const delta = 0n;" \
  "3 000 factures d'achat tirées au hasard"
prouver "le remboursement d'un avoir fournisseur oublié dans ce qu'il couvre" $MA \
  "  return { net, brut: t.netAPayer + t.retenue - rendu - operee };" "  return { net, brut: t.netAPayer + t.retenue };" \
  "3 000 factures d'achat tirées au hasard"

# ── Les règlements fournisseurs, le reste et le statut d'un achat (moteur/achats.ts) ────────────
prouver "le remboursement d'un avoir fournisseur écrit comme un paiement" $MA \
  "  const sens = achat.nature === 'avoir' ? -1n : 1n;" "  const sens = 1n;" \
  "le remboursement d'un avoir fournisseur fait entrer l'argent"
prouver "le fournisseur soldé au cours du jour" $MA \
  "  const soldeTiers = sens * versLaBase(reglement.montant, achat.devise, achat.cours, base);" "  const soldeTiers = sens * versLaBase(reglement.montant, achat.devise, coursDuJour, base);" \
  "la banque paie au cours du jour"
prouver "le fournisseur soldé au cours du jour (vu par le banc)" $MA \
  "  const soldeTiers = sens * versLaBase(reglement.montant, achat.devise, achat.cours, base);" "  const soldeTiers = sens * versLaBase(reglement.montant, achat.devise, coursDuJour, base);" \
  "avec avoirs remboursés, acomptes payés et cours du jour"
prouver "une perte de change au paiement écrite en gain" $MA \
  "  if (ecart > 0n) poser(comptes.pertesChange, 'change', ecart, 'debit');" "  if (ecart > 0n) poser(comptes.gainsChange, 'change', ecart, 'debit');" \
  "la banque paie au cours du jour"
prouver "la retenue opérée oubliée sur le compte du fournisseur" $MA \
  "  poser(comptes.fournisseurs, 'fournisseur', soldeTiers + retenue, 'debit');" "  poser(comptes.fournisseurs, 'fournisseur', soldeTiers, 'debit');" \
  "c'est ici qu'elle naît"
prouver "un avoir imputé compté encore comme un crédit" $MA \
  "reste: rattache ? 0n : paye - t.netAPayer" "reste: paye - t.netAPayer" \
  "le reste d'un achat et son statut"
prouver "les avoirs et acomptes oubliés dans le reste d'un achat" $MA \
  "  return { paye, impute, reste: t.netAPayer - paye - impute };" "  return { paye, impute, reste: t.netAPayer - paye };" \
  "le reste d'un achat et son statut"
prouver "un avoir remboursé en partie dit remboursé" $MA \
  "solde.paye > 0n && solde.reste >= 0n ? 'rembourse'" "solde.paye > 0n ? 'rembourse'" \
  "le reste d'un achat et son statut"
prouver "un achat en retard le jour même de l'échéance" $MA \
  "  if (echeance && echeance < aujourdhui) return 'en_retard';" "  if (echeance && echeance <= aujourdhui) return 'en_retard';" \
  "le reste d'un achat et son statut"

# ── Le bulletin de paie (moteur/paie.ts) ────────────────────────────────────────────────────────
MP=moteur/paie.ts
prouver "l'IRPP d'une tranche entière quand le revenu s'arrête au milieu" $MP \
  "    if (haut > depuis) impot += (haut - depuis) * t.taux;" "    if (haut > depuis) impot += ((t.jusqua ?? haut) - depuis) * t.taux;" \
  "ne taxe chaque tranche que sur la part"
prouver "les primes non imposables dans l'assiette de la CNSS" $MP \
  "  const assietteCnss = brutDeBase - retenueAbsence + primesImposables;" "  const assietteCnss = brutDeBase - retenueAbsence + primesImposables + primesNonImposables;" \
  "un bulletin complet, ligne par ligne"
prouver "les frais professionnels sans plafond" $MP \
  "  const fraisPro = pro < bareme.plafondFraisPro ? pro : bareme.plafondFraisPro;" "  const fraisPro = pro;" \
  "20 000 bulletins tirés au hasard"
prouver "les enfants au-delà du plafond comptés" $MP \
  "  const enfants = Math.min(salarie.enfants ?? 0, bareme.enfantsMax);" "  const enfants = salarie.enfants ?? 0;" \
  "les enfants au-delà du plafond ne comptent pas"
prouver "un régime sans IRPP qui en retient" $MP \
  "  const irppAn = bareme.sansIrpp ? 0n : irppAnnuel(imposableAnnuel, bareme.tranches);" "  const irppAn = irppAnnuel(imposableAnnuel, bareme.tranches);" \
  "un régime sans IRPP n'en retient pas"
prouver "l'IRPP du mois tronqué au lieu d'arrondi" $MP \
  "  const irpp = diviserArrondi(irppAn, 12n);" "  const irpp = irppAn / 12n;" \
  "un bulletin complet, ligne par ligne"
prouver "la solidarité calculée avant les déductions" $MP \
  "  const css = diviserArrondi(imposableAnnuel * bareme.solidarite, 12n * MILLION);" "  const css = diviserArrondi(annuel * bareme.solidarite, 12n * MILLION);" \
  "un bulletin complet, ligne par ligne"
prouver "l'absence comptée sur trente jours au lieu des jours ouvrables" $MP \
  "diviserArrondi(brutDeBase * absence, saisie.joursOuvrables)" "diviserArrondi(brutDeBase * absence, 30_000n)" \
  "20 000 bulletins tirés au hasard"
prouver "une base imposable négative gardée" $MP \
  "  const imposableAnnuel = reste > 0n ? reste : 0n;" "  const imposableAnnuel = reste;" \
  "20 000 bulletins tirés au hasard"

prouver "les retenues diverses oubliées dans ce qui est dû au salarié" $MP \
  "  poser(comptes.personnel, b.net + b.autresRetenues, 'credit');" "  poser(comptes.personnel, b.net, 'credit');" \
  "l'écriture du bulletin"
prouver "l'accident du travail oublié dans la dette CNSS" $MP \
  "  poser(comptes.cnss, b.cnssSalarie + b.cnssEmployeur + b.accidentTravail, 'credit');" "  poser(comptes.cnss, b.cnssSalarie + b.cnssEmployeur, 'credit');" \
  "l'écriture du bulletin"
prouver "un bulletin au net négatif écrit" $MP \
  "  if (b.brut <= 0n || b.net < 0n) throw" "  if (b.brut <= 0n) throw" \
  "l'écriture du bulletin"
prouver "la contribution de solidarité oubliée au crédit de l'État" $MP \
  "  poser(comptes.irpp, b.irpp + b.css, 'credit');" "  poser(comptes.irpp, b.irpp, 'credit');" \
  "chaque bulletin, et chaque salaire versé, s'écrit au même millime"
# ── Les déclarations lues dans les écritures (moteur/declarations.ts) ───────────────────────────
MD=moteur/declarations.ts
prouver "le dernier jour du mois oublié" $MD \
  "    if (e.date < du || e.date > au) continue;" "    if (e.date < du || e.date >= au) continue;" \
  "bornes comprises"
prouver "le crédit de TVA qui ne se reporte pas" $MD \
  "    report = d.creditReporte;" "    report = 0n;" \
  "un crédit de TVA se reporte sur le mois suivant"
prouver "le crédit de TVA qui ne se reporte pas (vu par la v10)" $MD \
  "    report = d.creditReporte;" "    report = 0n;" \
  "chaque mois des cinq ans de l'exemple : même TVA"
prouver "la TVA déductible ajoutée au lieu d'être retranchée" $MD \
  "  const solde = collectee - deductible - reportRecu;" "  const solde = collectee + deductible - reportRecu;" \
  "chaque mois des cinq ans de l'exemple : même TVA"
prouver "les retenues subies lues dans le mauvais sens" $MD \
  "    retenuesSubies: mouvement(ecritures, comptes.retenueSubie, du, au)," "    retenuesSubies: -mouvement(ecritures, comptes.retenueSubie, du, au)," \
  "chaque mois des cinq ans de l'exemple : même TVA"
prouver "un report négatif reçu" $MD \
  "  const reportRecu = report > 0n ? report : 0n;" "  const reportRecu = report;" \
  "un report négatif ne se reçoit pas"

prouver "l'imputation d'un acompte qui garde sa TVA déductible (vu par la déclaration)" $MA \
  "  poser(comptes.avancesFournisseurs, 'avance', ta.base.totalTTC - ta.base.tvaDeductible, 'credit');|||  poser(comptes.tvaDeductible, 'tva', ta.base.tvaDeductible, 'credit');" "  poser(comptes.avancesFournisseurs, 'avance', ta.base.totalTTC, 'credit');|||" \
  "chaque mois des cinq ans de l'exemple : même TVA"
prouver "le trimestre décalé d'un mois" $MP \
  "  const premier = (trimestre - 1) * 3 + 1;" "  const premier = (trimestre - 1) * 3 + 2;" \
  "même déclaration CNSS"
prouver "l'accident du travail oublié dans le total CNSS" $MP \
  "    l.total = l.partSalarie + l.partEmployeur + l.accident;" "    l.total = l.partSalarie + l.partEmployeur;" \
  "même déclaration CNSS"
prouver "les jours d'absence comptés comme travaillés" $MP \
  "    const jours = b.joursOuvrables - (b.joursAbsence ?? 0n);" "    const jours = b.joursOuvrables;" \
  "même déclaration CNSS"
prouver "les bulletins d'une autre année dans le trimestre" $MP \
  "  const dans = bulletins.filter((b) => b.annee === annee && b.mois" "  const dans = bulletins.filter((b) => b.mois" \
  "même déclaration CNSS"
# ── Les limites d'appels par clé (serveur/limites.ts, serveur/app.ts) ───────────────────────────
ML=serveur/limites.ts
prouver "un seau qui se remplit au-delà de sa capacité" $ML \
  "    s.jetons = Math.min(this.capacite, s.jetons + (Math.max(0, t - s.vu) / 1000) * this.parSeconde);" "    s.jetons = s.jetons + (Math.max(0, t - s.vu) / 1000) * this.parSeconde;" \
  "un seau ne se remplit jamais au-delà de sa capacité"
prouver "une horloge qui recule vide le seau" $ML \
  "s.jetons + (Math.max(0, t - s.vu) / 1000)" "s.jetons + ((t - s.vu) / 1000)" \
  "un seau ne se remplit jamais au-delà de sa capacité"
prouver "un seul seau pour toutes les clés" $ML \
  "    const s = this.seaux.get(qui) ??|||    this.seaux.set(qui, s);" "    const s = this.seaux.get('toutes') ??|||    this.seaux.set('toutes', s);" \
  "au-delà de sa rafale, une clé reçoit 429"
prouver "les limites d'appels qui ne s'appliquent pas" serveur/app.ts \
  "        if (cle) {" "        if (cle && false) {" \
  "au-delà de sa rafale, une clé reçoit 429"
prouver "un refus sans l'attente à respecter" serveur/app.ts \
  "            reponse.header('retry-after', String(v.attendreSecondes));
            return envoyer(429, { motif: v.attendreSecondes === 1 ? motif('api." "            return envoyer(429, { motif: v.attendreSecondes === 1 ? motif('api." \
  "au-delà de sa rafale, une clé reçoit 429"

# ── Les avis d'événement (0008, serveur/avis.ts) ────────────────────────────────────────────────
MV=base/migrations/0008_avis.sql
AV=serveur/avis.ts
T1="une facture émise est annoncée, signée"
T2="un échec se renvoie à 1 min"
T3="un abonnement arrêté n'envoie plus rien"
prouver "une facture émise qui n'est pas annoncée" serveur/ventes/pieces.ts \
  "  await emettreAvis(tx, entreprise, 'facture.emise', {" "  if (Date.now() < 0) await emettreAvis(tx, entreprise, 'facture.emise', {" \
  "$T1"
prouver "l'avis d'une entreprise envoyé aux abonnés d'une autre" $MV \
  "   where a.entreprise = p_entreprise and a.arrete_le is null and p_evenement = any(a.evenements);" "   where a.arrete_le is null and p_evenement = any(a.evenements);" \
  "$T1"
prouver "le secret de signature lisible par le serveur" $MV \
  "grant select (id, entreprise, url, evenements, cree_par, cree_le, arrete_le, arrete_par) on socle.abonnement_avis" "grant select (id, entreprise, url, evenements, secret, cree_par, cree_le, arrete_le, arrete_par) on socle.abonnement_avis" \
  "$T1"
prouver "une signature sans l'horodatage (un avis rejoué passerait)" $AV \
  "update(\`\${horodatage}.\${corps}\`)" "update(corps)" \
  "la signature est le HMAC-SHA256"
prouver "le livreur qui atteint une adresse privée" $AV \
  "  if (!adresses.length || adresses.some((a) => adressePrivee(a.address))) throw new Error('adresse_privee');" "" \
  "une adresse privée, locale ou réservée n'est jamais atteinte"
prouver "un échec renvoyé tout de suite, sans délai" $MV \
  "prochain_essai = p_maintenant + delais[v.essais + 1]," "prochain_essai = p_maintenant," \
  "$T2"
prouver "un avis jamais abandonné" $MV \
  "  elsif v.essais + 1 >= 8 then" "  elsif false then" \
  "$T2"
prouver "deux livreurs qui envoient le même avis" $MV \
  "  update socle.avis v set prochain_essai = p_maintenant + interval '5 minutes'" "  update socle.avis v set prochain_essai = p_maintenant" \
  "$T2"
prouver "un abonnement arrêté qui envoie encore ce qui attendait" $MV \
  "  update socle.avis set abandonne_le = now(), derniere_erreur = 'abonnement_arrete'" "  update socle.avis set abandonne_le = abandonne_le, derniere_erreur = 'abonnement_arrete'" \
  "$T3"
prouver "un abonnement arrêté qui reçoit les nouveaux faits" $MV \
  "   where a.entreprise = p_entreprise and a.arrete_le is null and p_evenement" "   where a.entreprise = p_entreprise and p_evenement" \
  "$T3"
prouver "la gestion des avis donnée à une clé de l'API" serveur/porte/gestes.ts \
  "  { code: 'socle.avis.gerer', module: 'socle', horsCle: true," "  { code: 'socle.avis.gerer', module: 'socle'," \
  "$T3"

# ── La sauvegarde et l'exercice de restauration (base/sauvegarde.ts) ────────────────────────────
BS=base/sauvegarde.ts
prouver "un maillon falsifié qui passe l'exercice" $BS \
  "         where rang <> attendu or precedente <> avant or empreinte <> socle.empreinte_maillon(precedente, contenu)" "         where false" \
  "un maillon falsifié et une série qui ne tombe plus juste"
prouver "une série qui ne tombe plus juste et passe l'exercice" $BS \
  "      having count(p.id) <> coalesce(ch.rang, 0)" "      having false" \
  "un maillon falsifié et une série qui ne tombe plus juste"
prouver "une sauvegarde abîmée restaurée sans le dire" $BS \
  "  if (sha256Fichier(fichier) !== m.empreinte) {" "  if (Date.now() < 0) {" \
  "un fichier abîmé est refusé"
prouver "des lignes perdues qui passent l'exercice" $BS \
  "      if (m.tables[t] !== comptes[t]) erreurs.push(" "      if (Date.now() < 0) erreurs.push(" \
  "un fichier abîmé est refusé"
prouver "la base de l'exercice laissée derrière lui" $BS \
  "    if (!opts.garder) {" "    if (Date.now() < 0) {" \
  "une sauvegarde saine se restaure dans une base vide"

# ── Le programme serveur (serveur/principal.ts) ─────────────────────────────────────────────────
SP=serveur/principal.ts
prouver "la production qui démarre sans fournisseur de SMS" $SP \
  "  if (environnement === 'production') throw" "  if (Date.now() < 0) throw" \
  "une configuration fausse l'arrête"
prouver "un SMS qui ne part pas, en silence" $SP \
  "{ envoyer: async () => { throw new Refus(" "{ envoyer: async () => { if (Date.now() > 0) return; throw new Refus(" \
  "un SMS ne part jamais en silence"
prouver "un livreur qui ne tourne pas" $SP \
  "    tour = livrerAvis(pool, envoyer)" "    tour = Promise.resolve()" \
  "livre les avis dus à chaque tour"
prouver "un programme qui écoute encore après son arrêt" $SP \
  "      await app.close();" "" \
  "livre les avis dus à chaque tour"

# ── L'entreprise d'essai des développeurs (0009, 0011) ────────────────────────────────────────────────
ME9=base/migrations/0009_entreprise_essai.sql
TE="une par personne, garnie de clients d'exemple"
# Sa fonction de création est refaite par 0011 (la série « FAC » de la v10) : c'est là qu'on la retouche.
ME11=base/migrations/0011_dossier_v10.sql
prouver "deux entreprises d'essai pour la même personne" $ME11 \
  "  if exists (select 1 from socle.entreprise e join socle.membre m on m.entreprise = e.id" "  if false and exists (select 1 from socle.entreprise e join socle.membre m on m.entreprise = e.id" \
  "$TE"
prouver "une entreprise d'essai qui devient vraie" $ME9 \
  "  if new.essai is distinct from old.essai then perform socle.refus(" "  if false then perform socle.refus(" \
  "$TE"
prouver "une entreprise d'essai qui n'est pas marquée" $ME11 \
  "|| v_nom, true) returning id into v_ent;" "|| v_nom, false) returning id into v_ent;" \
  "$TE"
prouver "une entreprise d'essai qui annonce à l'écran un autre numéro que le sien" $ME11 \
  "(v_ent, 'facture', 'FAC', true);" "(v_ent, 'facture', 'ESSAI', true);" \
  "$TE"

# ── Les écrans (web/) : l'entrée, le code v10 repris, son pont, le téléphone ─────────────────────
RE="les écrans de l'entrée, sur un téléphone et un ordinateur"
RV="les pages du quotidien de la v10"
PA="du compte à la facture émise par le serveur"
CO="deux onglets modifient le même client"
VR="dans une vraie entreprise"
PONT=web/public/plateforme/pont.js
TEL=web/public/plateforme/telephone.css
prouver "une phrase écrite en dur dans un écran de l'entrée" web/src/ecrans/Porte.tsx \
  "onClick={() => { void essai(); }}>{titre('ecran.porte.essai_bouton')}</Bouton>" "onClick={() => { void essai(); }}>Commencer la découverte</Bouton>" \
  "$RE"
prouver "un bouton de l'entrée trop petit pour un doigt" web/src/entree.css \
  "  min-height: 50px; height: auto; padding: 10px 18px;" "  min-height: 30px; height: 30px; padding: 0 18px;" \
  "$RE"
prouver "les lignes d'une facture plus larges que le téléphone (la grille de la v10)" $TEL \
  '    grid-template-columns: repeat(3, minmax(0, 1fr));|||    grid-template-areas: "lab lab lab" "qte unite pu" "tva total total" "outils outils outils";' \
  '    grid-template-columns: 64px 104px 108px 84px minmax(0, 1fr) 126px;|||    grid-template-areas: "lab lab lab lab lab outils" "qte unite pu tva total total";' \
  "$RV"
prouver "les listes et les onglets de la v10 laissés à la taille de la souris" $TEL \
  "  .combo-btn, .tabs button, .somm-chip, .row-menu-btn, .pp-guide, .collapse-h { min-height: 44px; }" "" \
  "$RV"
prouver "le téléphone sans menu" web/public/plateforme/telephone.js \
  "    tete.appendChild(b);" "" \
  "$PA"
# Depuis le lot onboarding (0076), le code n'est exigé que du comptable d'un cabinet : la porte d'une entreprise ne le
# demande plus ; ce sont les pages de l'entreprise et du cabinet qui renvoient à l'écran du code qui manque.
prouver "une entreprise ouverte sans le code du téléphone que son rôle exige" $PONT \
  "    if (r.status === 403 && lu.bouton === 'compte.code.configurer') { location.replace('/'); throw new Error(lu.motif); }
    if (!r.ok) {" \
  "    if (!r.ok) {" \
  "la page de son entreprise, puis celle du cabinet"
prouver "un cabinet ouvert sans le code du téléphone que son rôle exige" web/public/plateforme/pont-cabinet.js \
  "    if (r.status === 403 && lu.bouton === 'compte.code.configurer') { location.replace('/'); throw new Error(lu.motif); }" "" \
  "la page de son entreprise, puis celle du cabinet"
prouver "un net à payer de l'écran qui n'est pas celui que le serveur scelle" $PONT \
  "netAPayer: Number(netAPayer).toFixed(decimales)," "netAPayer: Number(netAPayer + 0.001).toFixed(decimales)," \
  "$PA"
prouver "« Se déconnecter » qui ne ferme rien" $PONT \
  "      try { sessionStorage.removeItem('skanfact.jeton'); localStorage.removeItem('skanfact.jeton'); } catch { /* rien à retirer */ }
      await poste.effacer();
      location.replace('/');" "      void 0;" \
  "$PA"
prouver "un conflit d'enregistrement qui finit en « Rien n'a été enregistré »" $PONT \
  "        if (/** @type {any} */ (e).statut === 409) return { conflict: true, disk: Object.assign(await relire(), { syncWrittenAt: Date.now() }) };" "" \
  "$CO"
prouver "un conflit tranché contre le serveur (l'onglet en retard écrase)" $PONT \
  "disk: Object.assign(await relire(), { syncWrittenAt: Date.now() }) };" "disk: await relire() };" \
  "$CO"
prouver "l'exemple écrit dans la vraie entreprise" $PONT \
  "      if (!essai || essai.id !== ent) {" "      if (!essai) {" \
  "depuis une vraie entreprise, l'exemple ouvre l'entreprise d'essai : rien ne se verse ici"
prouver "« Tout effacer » laissé sur la plateforme" $PONT \
  "'p-ocr', 'p-danger', 'p-maj'" "'p-ocr', 'p-maj'" \
  "$VR"
prouver "un fichier exporté qui perd son nom" $PONT \
  "    a.href = url; a.download = propre; a.hidden = true;" "    a.href = url; a.download = 'export.txt'; a.hidden = true;" \
  "$VR"
prouver "un fichier de la v10 retouché à la main" web/public/v10/listes.js \
  "'use strict';" "'use strict'; /* retouche */" \
  "chaque fichier repris a l'empreinte"
prouver "une adaptation écrite qui n'a pas été reprise" web/v10/adaptations.mjs \
  "const canUnlock = !bridge.emettre && locked" "const canUnlock = !bridge.emettre &&  locked" \
  "chaque adaptation écrite est dans le code repris"
prouver "la réécriture voulue d'une adaptation par une plus récente, comptée comme une perte" tests/v10/provenance.test.ts \
  "j > i && b.fichier === a.fichier" "j > i && b.fichier === a.fichier && false" \
  "chaque adaptation écrite est dans le code repris"
prouver "le dossier v10 servi comme l'entrée (la page se recharge sans fin)" serveur/principal.ts \
  "    if (fs.existsSync(fichier) && fs.statSync(fichier).isDirectory()) fichier = path.join(fichier, 'index.html');" "" \
  "$PA"
prouver "les écrans servis hors de leur dossier" serveur/principal.ts \
  "    if (!fichier.startsWith(racine + path.sep) && fichier !== racine) return reponse.code(404).send({});" "" \
  "il sert les écrans à côté de l'API"
prouver "des écrans sans leurs en-têtes de sécurité" serveur/principal.ts \
  "      .header('content-security-policy', POLITIQUE)" "" \
  "il sert les écrans à côté de l'API"

# ── Le dossier v10 tenu par le serveur (0011) ───────────────────────────────────────────────────
DV=serveur/v10/dossier.ts
prouver "le dossier amorcé sans l'ordre des clients" $DV \
  "rang: o.collection === '_racine' ? null : i - 1," "rang: o.collection === '_racine' ? null : 0," \
  "le premier chargement naît de la fiche"
prouver "un objet changé ailleurs écrasé sans le dire" $DV \
  "    if ((a ? Number(a.revision) : null) !== c.revision) conflits.push({ collection: c.collection, cle: c.cle });" "" \
  "un objet changé ailleurs n'est jamais écrasé"
prouver "un nombre à virgule accepté dans le dossier" serveur/v10/routes.ts \
  "z.union([z.number().int(), z.string()," "z.union([z.number(), z.string()," \
  "jamais un nombre à virgule en base"
prouver "une facture émise par l'interface, sans le serveur" $DV \
  "  if (emise(apres) || (apres && typeof apres.number === 'string' && apres.number !== '')) throw new Refus('v10.emission_par_le_serveur');" "" \
  "une facture ou un avoir ne devient émis que par le serveur"
prouver "une émission dont le net à payer diffère de l'écran" $DV \
  "  if (demande.netAPayer !== null && serveur !== demande.netAPayer) throw" "  if (Date.now() < 0) throw" \
  "l'émission : le numéro du serveur"
prouver "les lignes d'une facture émise encore modifiables" $DV \
  "'exchangeRate', 'lines', 'discountRate'" "'exchangeRate', 'discountRate'" \
  "une facture émise ne change plus ce qui a été scellé"
prouver "une facture émise refusée parce que la base a rangé ses clés autrement" $DV \
  "(champ === 'withholdingRate' ? tauxRelu(v) : canonique(v));" "(champ === 'withholdingRate' ? tauxRelu(v) : JSON.stringify(v));" \
  "une facture émise ne change plus ce qui a été scellé"
prouver "une facture émise qu'on peut effacer" $DV \
  "    if (!apres) throw new Refus(av ? 'v10.avoir_ne_s_efface_pas' : 'v10.emise_ne_s_efface_pas', numero);" "    if (!apres) return;" \
  "une facture émise ne change plus ce qui a été scellé"

# ── Les écrans des ventes : les listes paginées, la facture à l'écran ───────────────────────────
LI="les factures, la plus récente d'abord, page après page"
CL="les clients, par ordre alphabétique, page après page"
R7L="R7 : dans la liste comme en la lisant"
CH="un champ refusé donne aussi sa raison seule"
prouver "une page de factures qui oublie l'identifiant (trois le même jour)" serveur/ventes/routes.ts \
  '(p.date_piece, p.id) < (${avant?.[0]}::date, ${avant?.[1]}::uuid)' 'p.date_piece < ${avant?.[0]}::date' \
  "$LI"
prouver "une liste de factures dans le désordre" serveur/ventes/routes.ts \
  ".orderBy('p.date_piece', 'desc').orderBy('p.id', 'desc')" ".orderBy('p.id', 'asc')" \
  "$LI"
prouver "une dernière page qui annonce une suite" serveur/ventes/routes.ts \
  "        plein = lignes.length === n;" "        plein = true;" \
  "$LI"
prouver "une page de clients qui oublie l'identifiant (deux du même nom)" serveur/ventes/routes.ts \
  '(raison_sociale, id) > (${apres?.[0]}, ${apres?.[1]}::uuid)' 'raison_sociale > ${apres?.[0]}' \
  "$CL"
prouver "la liste qui montre la fiche du client au lieu de la copie figée" serveur/ventes/routes.ts \
  "coalesce(p.copie->'client'->>'raisonSociale', t.raison_sociale)" "t.raison_sociale" \
  "$R7L"
prouver "la lecture qui montre la fiche du client au lieu de la copie figée" serveur/ventes/pieces.ts \
  "    client: figee ?? fiche.raison_sociale," "    client: fiche.raison_sociale," \
  "$R7L"
prouver "un taux illisible qui fait tomber le serveur (500)" serveur/ventes/routes.ts \
  "  try { t = depuisTexte(v, DECIMALES.taux); } catch { return true; }" "  t = depuisTexte(v, DECIMALES.taux);" \
  "$CH"
prouver "un refus sans sa raison seule" serveur/app.ts \
  ", champ: p ? champ : null, raison: pourquoi });" ", champ: p ? champ : null });" \
  "$CH"
# ── L'avoir et les règlements par le serveur (0012, brique 29) ──────────────────────────────────
AV="l'avoir s'émet par le serveur : série AVO"
RG="les règlements d'une facture émise sont tenus par le serveur"
PV="un paiement ne se saisit que sur une facture émise"
PX="une facture émise, puis payée en partie et corrigée par un avoir, à la souris"
M12=base/migrations/0012_avoirs_reglements.sql
RGS=serveur/ventes/reglements.ts
V10A=web/public/v10/app.js
prouver "un avoir numéroté dans la série des factures" serveur/ventes/pieces.ts \
  ".where('entreprise', '=', entreprise).where('type', '=', p.type).where('legale', '=', true).where('active', '=', true)" ".where('entreprise', '=', entreprise).where('type', '=', 'facture').where('legale', '=', true).where('active', '=', true)" \
  "$AV"
prouver "un avoir émis sans dire quelle facture il corrige" $DV \
  "    if (!f) throw new Refus('ventes.avoir_sans_facture');" "" \
  "$AV"
prouver "un avoir émis par la route de la facture (celle du commercial)" $DV \
  "  if (!cle || doc.type !== type) throw new Refus('ventes.seule_facture');" "  if (!cle) throw new Refus('ventes.seule_facture');" \
  "$AV"
prouver "un avoir émis qui change de facture" $DV \
  "'stampFee', 'creditOf', 'creditReason', 'prixTtc'];" "'stampFee', 'creditReason', 'prixTtc'];" \
  "$AV"
prouver "la facture corrigée hors du scellé de l'avoir" serveur/ventes/pieces.ts \
  "    ...(p.type === 'avoir' ? { corrige: p.corrige } : {})," "" \
  "$AV"
prouver "une facture émise qu'on marque annulée" $DV \
  "    if (apres.status === 'annulée') throw new Refus('v10.annulee', numero);
    if (apres.status !== STATUT_EMISE[type])" "    if (!['envoyée', 'annulée', 'émis'].includes(String(apres.status)))" \
  "une facture émise ne change plus ce qui a été scellé"
prouver "un règlement enregistré sans sa trace" serveur/reglements.ts \
  "      await tracer(tx, entreprise, \`\${cote.trace}.enregistrer\`, { type: 'reglement', id }, null, pourTrace(r));" "" \
  "$RG"
prouver "un règlement retiré de l'écran qui reste au serveur" serveur/reglements.ts \
  "    await db.deleteFrom(table).where('id', '=', a.id).execute();" "" \
  "$RG"
prouver "un règlement modifié qui garde son ancien montant au serveur" serveur/reglements.ts \
  "    const change = avant.date !== r.date || avant.montant !== r.montant ||" "    const change = avant.date !== r.date ||" \
  "$RG"
prouver "un paiement plus précis que sa devise accepté" serveur/v10/lecture.ts \
  "    try { montant = depuisTexte(texte, decimales); }" "    try { montant = depuisTexte(texte, 6); }" \
  "$RG"
prouver "un paiement daté d'un jour qui n'existe pas" serveur/v10/lecture.ts \
  "  if (typeof v !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}\$/.test(v)) return false;" "  if (typeof v === 'string') return true;" \
  "$RG"
prouver "la retenue ôtée des règlements (le reste compté sur le brut)" $RGS \
  "  const fil = retenueAuFil(net, net + retenue, liees, regles);" "  const fil = retenueAuFil(net, net, liees, regles);" \
  "$RG"
prouver "un paiement saisi sur un brouillon" $DV \
  "    if (paiements.length) throw new Refus('v10.reglement_sur_brouillon');" "" \
  "$PV"
prouver "la base qui accepte un règlement sur une facture non émise" $M12 \
  "and p.type = 'facture' and p.statut = 'emise'" "and p.type = 'facture'" \
  "$PV"
prouver "les règlements sans sécurité par ligne forcée" $M12 \
  "alter table ventes.reglement force row level security;" "" \
  "chaque table de chaque schéma a sa sécurité par ligne, forcée"
prouver "l'avoir envoyé par la route de la facture (le pont)" $PONT \
  "doc.type === 'avoir' ? '/dossier-v10/emettre-avoir' : '/dossier-v10/emettre'" "'/dossier-v10/emettre'" \
  "$PX"
prouver "« Marquer annulée… » encore proposé" $V10A \
  "\${bridge.emettre ? '' : s.status === 'annulée' ?" "\${s.status === 'annulée' ?" \
  "$PX"
prouver "un paiement trop précis découvert seulement à l'enregistrement" $V10A \
  "        const v = formValues(\$('#pf2', root));
        if (enLecture('documents')) return refus(\$('[name=amount]', root), refusLecture('documents'));
        if (!(Number(v.amount) > 0)) return refus(\$('[name=amount]', root), 'Montant invalide.');
        if (bridge.emettre && (String(v.amount).split('.')[1] || '').length > C.decimalsFor(cur)) return refus(\$('[name=amount]', root), \`Un montant en \${cur} se compte à \${C.decimalsFor(cur)} décimales au plus.\`);
" "        const v = formValues(\$('#pf2', root));
        if (enLecture('documents')) return refus(\$('[name=amount]', root), refusLecture('documents'));
        if (!(Number(v.amount) > 0)) return refus(\$('[name=amount]', root), 'Montant invalide.');
" \
  "$PX"
prouver "la caisse qui vend sans le serveur" $V10A \
  "      if (bridge.encaisser) {" "      if (false) {" \
  "la caisse est en ligne"

# ── Les achats tenus par le serveur (0013, brique 30) ───────────────────────────────────────────
VA=serveur/v10/achats.ts
EA=serveur/achats/etat.ts
M13=base/migrations/0013_achats.sql
ACX="les 181 achats de l'exemple de cinq ans"
AH="200 achats tirés au hasard"
AM="un achat se modifie et se supprime comme dans la v10"
ARG="sans choix sur la pièce, récupérer la TVA suit le régime"
AR="un avoir et un acompte rattachés se déduisent de leur facture"
AI="un seul achat illisible, et rien de l'envoi n'est écrit"
AL="la liste des achats, page après page"
AB="la base refuse elle-même un fournisseur ou une facture"
AP="un achat saisi, réglé puis corrigé par un avoir, à la souris"
prouver "un achat qui ignore le choix « récupérer la TVA » de sa pièce" $VA \
  "    tvaRecuperable: typeof p.tvaRecuperable === 'boolean' ? p.tvaRecuperable : recuperableParDefaut," "    tvaRecuperable: recuperableParDefaut," \
  "$AH"
prouver "un achat qui ignore le régime de l'entreprise" $VA \
  "  const recuperable = !REGIMES_SANS_TVA.includes(String(societe?.taxRegime ?? '').trim());" "  const recuperable = societe !== undefined;" \
  "$ARG"
prouver "une ligne d'achat dont la TVA non déductible est déduite" $VA \
  "nonDeductible: x.deductible === false };" "nonDeductible: false };" \
  "$AH"
prouver "une ligne d'achat rangée en charge quoi qu'elle soit" $VA \
  "    const destination = (DESTINATIONS as unknown[]).includes(x.destination) ? x.destination as Destination : 'charge';" "    const destination: Destination = DESTINATIONS[0] ?? 'charge';" \
  "$AM"
prouver "les frais d'un achat oubliés dans son total" $VA \
  "lignes: a.lignes.map((l) => ({ ...l })), frais: a.frais," "lignes: a.lignes.map((l) => ({ ...l }))," \
  "$AM"
prouver "un achat seulement déplacé dans la liste, recalculé et tracé" serveur/v10/lecture.ts \
  "export const aVraimentChange = (c: ChangementLu) => c.apres === null || c.avant === null || canonique(c.avant) !== canonique(c.apres);" "export const aVraimentChange = (c: ChangementLu) => c.apres !== undefined || canonique(c.avant) === '';" \
  "$AM"
prouver "un avoir rattaché que le serveur ne rattache pas" $VA \
  "    await db.updateTable('achats.piece').set({ lie: cible })" "    await db.updateTable('achats.piece').set({})" \
  "$AR"
prouver "une facture supprimée sous son avoir" $VA \
  "    if (rattachee) throw new Refus('v10.achat_rattache');" "" \
  "$AR"
prouver "un avoir en euros rattaché à une facture en dinars" $VA \
  "eb.or([eb('f.devise', '<>', eb.ref('p.devise')), eb.not(" "eb.or([eb.not(" \
  "$AR"
prouver "un achat en devise accepté sans son taux" $VA \
  "    if (cours === null || cours <= 0n) throw new Refus('v10.achat_cours', { valeurs: { numero, devise } });" "    if (cours === null || cours <= 0n) cours = 1_000_000n;" \
  "$AI"
prouver "des frais plus précis que leur devise acceptés" $VA \
  "  const frais = exact(p.fees ?? 0, d.decimales);" "  const frais = exact(p.fees ?? 0, 6);" \
  "$AI"
prouver "un achat dont le fournisseur n'existe pas, accepté sans fournisseur" $VA \
  "      if (!s) throw new Refus('v10.achat_fournisseur', { valeurs: { numero } });
      fournisseur = await ficheFournisseur(tx, entreprise, ref, s);" "      if (s) fournisseur = await ficheFournisseur(tx, entreprise, ref, s);" \
  "$AI"
prouver "un règlement d'achat refusé avec les phrases d'une facture de vente" $VA \
  ", a.decimales, a.devise, 'v10.achat_reglement'));" ", a.decimales, a.devise));" \
  "$AI"
prouver "la retenue d'un achat oubliée au fil de ses règlements" $EA \
  "    const fil = retenueAuFil(t.netAPayer, t.netAPayer + t.retenue, pl, regs);" "    const fil = retenueAuFil(t.netAPayer, t.netAPayer, pl, regs);" \
  "$ACX"
prouver "un avoir rattaché qui ne diminue pas le reste de sa facture" $EA \
  "regs.map((r) => r.montant), pl.map((x) => x.net));" "regs.map((r) => r.montant), []);" \
  "$AR"
prouver "la liste des achats qui annonce le net au lieu du reste" serveur/achats/routes.ts \
  "            reste: etats.get(l.id)?.reste ?? null," "            reste: versTexte(l.net_a_payer, l.decimales)," \
  "$AL"
prouver "une page d'achats qui saute ceux du même jour" serveur/achats/routes.ts \
  "q.where((eb) => eb.or([eb('p.date_piece', '<', avant?.[0] ?? ''), eb.and([eb('p.date_piece', '=', avant?.[0] ?? ''), eb('p.id', '<', avant?.[1] ?? '')])]))" "q.where('p.date_piece', '<', avant?.[0] ?? '')" \
  "$AL"
prouver "un commercial qui voit les achats" serveur/achats/gestes.ts \
  "administrateur: 'oui', comptabilite_interne: 'oui', lecture: 'voir', supervision" "administrateur: 'oui', commercial: 'oui', comptabilite_interne: 'oui', lecture: 'voir', supervision" \
  "$AL"
prouver "la liste des factures de vente qui annonce le net au lieu du reste" serveur/ventes/routes.ts \
  "              reste: soldes.has(l.id) ? versTexte(soldes.get(l.id)?.reste ?? 0n, l.decimales) : net," "              reste: net," \
  "$RG"
prouver "la base qui accepte le fournisseur d'une autre entreprise" $M13 \
  "  if new.fournisseur is not null and not exists (" "  if false and not exists (" \
  "$AB"
prouver "la base qui laisse un règlement changer d'achat" $M13 \
  "  if tg_op = 'UPDATE' and new.piece <> old.piece then
    raise exception 'un règlement ne change pas de pièce'" "  if false then
    raise exception 'un règlement ne change pas de pièce'" \
  "$AB"
prouver "l'écran qui laisse supprimer une facture sous son avoir" $V10A \
  "      if (bridge.emettre && data.purchases.some(x => x.achatLie === p.id))" "      if (false)" \
  "$AP"
prouver "un règlement fournisseur trop précis découvert seulement à l'enregistrement" $V10A \
  "        const v = formValues(\$('#spf', root));
        if (!(Number(v.amount) > 0)) return refus(\$('[name=amount]', root), 'Montant invalide.');
        if (bridge.emettre" "        const v = formValues(\$('#spf', root));
        if (!(Number(v.amount) > 0)) return refus(\$('[name=amount]', root), 'Montant invalide.');
        if (false" \
  "$AP"
prouver "des frais d'achat trop précis découverts seulement à l'enregistrement" $V10A \
  "      if (bridge.emettre && (String(p.fees || 0)" "      if (false && (String(p.fees || 0)" \
  "$AP"

# ── La paie tenue par le serveur (0014, brique 31) ──────────────────────────────────────────────
VP=serveur/v10/paie.ts
RP=serveur/paie/routes.ts
GP=serveur/paie/gestes.ts
M14=base/migrations/0014_paie.sql
V10C=web/public/v10/compta.js
PX="les bulletins de l'exemple de cinq ans se recalculent au serveur"
PH="200 bulletins tirés au hasard (barèmes, régimes de contrat"
PB="un bulletin garde son barème : une loi de finances plus tard"
PR="un bulletin qui ne tombe pas juste, sans son barème"
PM="modifier, supprimer, chacun avec sa trace ; un bulletin seulement déplacé"
PL="la paie ne se lit qu'avec son geste"
PBA="la base refuse elle-même un bulletin d'un salarié d'une autre entreprise"
PP="la paie à la souris"
prouver "un bulletin enregistré sans comparer ses montants à ceux de l'écran" $VP \
  "    if (ecran !== calcul[n]) {" "    if (ecran === null && calcul[n] === -1n) {" \
  "$PR"
prouver "un bulletin recalculé sans la situation figée du salarié" $VP \
  "chefDeFamille: sit.headOfFamily === true, enfants: Number(enfants) };" "chefDeFamille: false, enfants: Number(enfants) };" \
  "$PX"
prouver "un bulletin recalculé sans les tranches de l'IRPP qu'il a figées" $VP \
  "    tranches: tranches.map((x) => ({ jusqua: x?.jusqua ?? null, taux: x?.taux ?? 0n }))," "    tranches: []," \
  "$PX"
prouver "un bulletin sans son barème, recalculé avec des zéros" $VP \
  "  const fige = c.bareme, sit = c.situation;" "  const fige = c.bareme ?? {}, sit = c.situation ?? {};" \
  "$PR"
prouver "un bulletin au net négatif accepté" $VP \
  "  if (calcul.net < 0n) throw new Refus('v10.bulletin_net', { valeurs: { salarie: nom, periode } });" "" \
  "$PR"
prouver "un bulletin au brut nul accepté" $VP \
  "  if (calcul.brut <= 0n) throw new Refus('v10.bulletin_brut', { valeurs: { salarie: nom, periode } });" "" \
  "$PR"
prouver "un taux du barème plus précis que quatre décimales, lu autrement" $VP \
  "  const taux = (v: unknown) => { const x = exact(v ?? 0, 4);" "  const taux = (v: unknown) => { const x = exact(v ?? 0, 6);" \
  "$PR"
prouver "une date de paiement impossible qui fait tomber le serveur" $VP \
  "  if (payeLe !== null && !estJour(payeLe)) throw new Refus('v10.bulletin_paye_le', { valeurs: { salarie: nom, periode } });" "" \
  "$PR"
prouver "un treizième mois qui fait tomber le serveur" $VP \
  "  if (!Number.isInteger(annee) || annee < 2000 || annee > 2200 || !Number.isInteger(mois) || mois < 1 || mois > 12) throw" "  if (false) throw" \
  "$PR"
prouver "un salarié aux enfants négatifs qui fait tomber le serveur" $VP \
  "  if (enfants === null || enfants < 0n || enfants > 99n) throw new Refus('v10.salarie_enfants'" "  if (enfants === null) throw new Refus('v10.salarie_enfants'" \
  "$PR"
prouver "la fiche du salarié réécrite et tracée pour un RIB" $VP \
  "  if (canonique(avant) !== canonique(fiche)) {" "  if (canonique(avant) !== '') {" \
  "$PM"
prouver "un bulletin retiré du dossier gardé au serveur" $VP \
  "    await db.deleteFrom('paie.bulletin').where('id', '=', b.id).execute();" "" \
  "$PM"
prouver "une modification de bulletin sans sa trace" $VP \
  "    await tracer(tx, entreprise, 'paie.bulletin.modifier'," "    if (deja.revision < 0n) await tracer(tx, entreprise, 'paie.bulletin.modifier'," \
  "$PB"
prouver "un bulletin seulement déplacé dans la liste, recalculé et tracé" serveur/v10/lecture.ts \
  "export const aVraimentChange = (c: ChangementLu) => c.apres === null || c.avant === null || canonique(c.avant) !== canonique(c.apres);" "export const aVraimentChange = (c: ChangementLu) => c.apres !== undefined || canonique(c.avant) === '';" \
  "$PM"
prouver "un bulletin qui ne fige pas la situation du salarié (la v10 telle quelle)" $V10C \
  "      situation: { headOfFamily: !!emp.headOfFamily, children: Number(emp.children) || 0 }
" "" \
  "$PX"
prouver "l'écran qui fige un barème sans les tranches de l'IRPP" $V10C \
  "        brackets: (s.brackets || DEFAULT_PAYROLL.brackets).map(b => ({ upTo: b.upTo == null ? null : Number(b.upTo), rate: Number(b.rate) || 0 }))" "        brackets: []" \
  "$PP"
prouver "la déclaration CNSS qui oublie les jours d'absence" $RP \
  "joursAbsence: l.jours_absence," "joursAbsence: 0n," \
  "$PX"
prouver "la masse salariale qui annonce le net pour le coût" $RP \
  "coutEmployeur: x(r?.cout_employeur)" "coutEmployeur: x(r?.net)" \
  "$PL"
prouver "une page de bulletins qui saute ceux du même mois" $RP \
  "q.where(sql<boolean>\`(to_char(make_date(b.annee, b.mois, 1), 'YYYY-MM'), b.id) < (\${avant?.[0] ?? ''}, \${avant?.[1] ?? ''}::uuid)\`)" "q.where(sql<boolean>\`to_char(make_date(b.annee, b.mois, 1), 'YYYY-MM') < \${avant?.[0] ?? ''}\`)" \
  "$PL"
prouver "le barème relu d'un bulletin avec ses taux cent fois trop petits" $RP \
  "const pct = (v: unknown) => versTexte(BigInt(Number(v) || 0), 4);" "const pct = (v: unknown) => versTexte(BigInt(Number(v) || 0), 6);" \
  "$PB"
prouver "la comptabilité interne qui lit les bulletins" $GP \
  "    roles: { proprietaire: 'oui', administrateur: 'oui', paie: 'oui', supervision: 'oui' } },
  { code: 'paie.declarations.voir'" "    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', paie: 'oui', supervision: 'oui' } },
  { code: 'paie.declarations.voir'" \
  "$PL"
prouver "la lecture d'un bulletin qui ne se trace pas" $GP \
  "  { code: 'paie.bulletins.voir', module: 'paie', ecrit: false, sensible: true," "  { code: 'paie.bulletins.voir', module: 'paie', ecrit: false," \
  "$PL"
prouver "un commercial qui voit la masse salariale" $GP \
  "roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', paie: 'oui', lecture: 'voir', supervision: 'oui' } }," "roles: { proprietaire: 'oui', administrateur: 'oui', commercial: 'oui', comptabilite_interne: 'oui', paie: 'oui', lecture: 'voir', supervision: 'oui' } }," \
  "$PL"
prouver "la trace d'une lecture qui ne dit pas quel bulletin" serveur/app.ts \
  "                const objet = r.objetLu && /^[0-9a-f-]{36}\$/i.test(lu) ? [r.objetLu.type, lu] : [null, null];" "                const objet = [null, null];" \
  "$PL"
# paie.mes_entreprises, paie.masse_salariale, compta.mes_entreprises et compta.valider sont
# redéfinies par 0019 (le cabinet) : leurs preuves visent la définition EN VIGUEUR.
prouver "la base qui montre la paie à la comptabilité interne" base/migrations/0019_cabinet.sql \
  "   where (socle.mes_roles(e) && array['proprietaire', 'administrateur', 'paie']::text[] and socle.perimetre_cabinet(e) is null)" "   where (socle.mes_roles(e) && array['proprietaire', 'administrateur', 'paie', 'comptabilite_interne']::text[] and socle.perimetre_cabinet(e) is null)" \
  "$PL"
prouver "la base qui ouvre la masse salariale au commercial" base/migrations/0019_cabinet.sql \
  "          and ((socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'comptabilite_interne', 'paie', 'lecture']::text[]" "          and ((socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'comptabilite_interne', 'commercial', 'paie', 'lecture']::text[]" \
  "$PL"
prouver "la masse salariale qui compte un bulletin au premier jour de son mois" base/migrations/0019_cabinet.sql \
  "       and (make_date(b.annee, b.mois, 1) + interval '1 month' - interval '1 day')::date between p_du and p_au;" "       and make_date(b.annee, b.mois, 1) between p_du and p_au;" \
  "$PL"
prouver "la base qui laisse un bulletin changer de salarié" $M14 \
  "  if tg_op = 'UPDATE' and new.salarie <> old.salarie then" "  if false then" \
  "$PBA"
prouver "la base qui accepte le salarié d'une autre entreprise" $M14 \
  "  if not exists (select 1 from paie.salarie s where s.id = new.salarie and s.entreprise = new.entreprise) then" "  if false and not exists (select 1 from paie.salarie s where s.id = new.salarie and s.entreprise = new.entreprise) then" \
  "$PBA"
prouver "la base qui garde un net qui ne se tient pas" $M14 \
  "  check (net = brut - cnss_salarie - irpp - css - autres_retenues),
" "" \
  "$PBA"
prouver "la base qui garde des charges qui oublient la TFP" $M14 \
  "  check (charges_patronales = cnss_employeur + accident_travail + tfp + foprolos),
" "" \
  "$PBA"
prouver "la base qui garde un coût qui oublie une charge" $M14 \
  "  check (cout_employeur = brut + charges_patronales)
);" "  check (true)
);" \
  "$PBA"
prouver "la base qui garde un barème à virgule" $M14 \
  "  bareme jsonb not null check (jsonb_typeof(bareme) = 'object' and socle.sans_virgule(bareme))," "  bareme jsonb not null check (jsonb_typeof(bareme) = 'object')," \
  "$PBA"
prouver "une clé employée par un module sans son texte" serveur/paie/textes.ts \
  "  'paie.champ.annee': 'une année, de 2000 à 2200',
" "" \
  "chaque clé employée par le code est déclarée"

# ── Les écritures des ventes tenues par le serveur (0015, brique 32) ────────────────────────────
CVS=serveur/compta/ventes.ts
CPL=serveur/compta/plan.ts
M15=base/migrations/0015_compta.sql
CV="chaque facture, chaque avoir et chaque encaissement de l'exemple s'écrit au serveur comme la v10"
CT="la TVA collectée de chaque mois, les timbres et les retenues subies"
CP="le plan comptable par défaut est celui de la v10"
LG="chaque geste de l'écran réécrit la famille, jamais en double"
LP="le plan de l'entreprise : ses propres comptes et ses comptes auxiliaires"
LA="l'API lit le journal page après page"
LD="les livres : la comptabilité interne et la lecture les lisent"
LB="la base refuse elle-même une écriture déséquilibrée"
prouver "un avoir écrit sans sa facture (ni son cours ni la retenue régularisée)" $CVS \
  "{ facture: enDevise(f), regularisationRetenue: fil.ajustements.get(a.id) ?? 0n });" "{ facture: enDevise(a), regularisationRetenue: 0n });" \
  "$LG"
prouver "un encaissement écrit sans sa part de retenue" $CVS \
  "fil.parts.get(r.id) ?? 0n, TND," "0n, TND," \
  "$LG"
prouver "la TVA d'une vente écrite au compte des ventes" $CVS \
  "tvaCollectee: plan.plan.tvaCollectee," "tvaCollectee: plan.plan.ventes," \
  "$CT"
prouver "le libellé d'une écriture sans le nom du client" $CVS \
  "  return typeof c?.raisonSociale === 'string' ? c.raisonSociale : '';" "  return '';" \
  "$LA"
prouver "un encaissement en espèces à la caisse quel que soit le compte de trésorerie" $CPL \
  "  const caisse = t ? t.caisse : ESPECES.includes(mode);" "  const caisse = ESPECES.includes(mode);" \
  "$LG"
prouver "les comptes auxiliaires ignorés" $CPL \
  "  const code = p.auxiliaires && tiers ? p.codesClients.get(tiers) : undefined;" "  const code = p.auxiliaires && tiers ? undefined : undefined;" \
  "$LP"
prouver "le plan réglé par l'entreprise ignoré" moteur/comptes.ts \
  "    if (NUMERO_DE_COMPTE.test(texte)) plan[role] = texte;" "    if (NUMERO_DE_COMPTE.test(texte) && texte === '') plan[role] = texte;" \
  "$LP"
prouver "un compte par défaut qui n'est pas celui de la v10" moteur/comptes.ts \
  "  ventes: '706'," "  ventes: '707'," \
  "$CP"
prouver "un plan changé qui ne réécrit pas le brouillard" serveur/v10/dossier.ts \
  "  if (await planChange(tx, entreprise, lus)) {" "  if (await planChange(tx, entreprise, lus) && entreprise === '') {" \
  "$LP"
prouver "un compte de trésorerie ajouté qui ne change pas le plan" serveur/compta/suivre.ts \
  "  if (vrais.some((c) => c.collection === 'accounts' &&" "  if (vrais.some((c) => c.collection === 'nulle-part' &&" \
  "$LG"
prouver "un encaissement qui ne réécrit pas sa famille" serveur/v10/dossier.ts \
  "  // Les écritures de sa famille (brique 32) : ses encaissements, et ses avoirs qui en dépendent.
  await ecrireFamilleDeVente(tx, entreprise, piece.id);" "" \
  "$LG"
prouver "une émission qui n'écrit pas son écriture" serveur/ventes/pieces.ts \
  "  await ecrireFamilleDeVente(tx, entreprise, p.type === 'avoir' ? (p.corrige ?? id) : id);" "" \
  "$LG"
prouver "un avoir qui réécrit sa propre famille au lieu de celle de sa facture" serveur/ventes/pieces.ts \
  "  await ecrireFamilleDeVente(tx, entreprise, p.type === 'avoir' ? (p.corrige ?? id) : id);" "  await ecrireFamilleDeVente(tx, entreprise, id);" \
  "$LG"
prouver "une famille réécrite sans effacer son ancien brouillard" base/migrations/0018_compta_validation.sql \
  "  delete from compta.ecriture where entreprise = p_entreprise and famille = p_famille and statut = 'brouillard';" "" \
  "$LG"
prouver "la base qui garde une écriture déséquilibrée" $M15 \
  "  if d <> c then" "  if false then" \
  "$LB"
prouver "la base qui garde une écriture d'une seule ligne" $M15 \
  "  if n < 2 then" "  if false then" \
  "$LB"
prouver "la base qui garde une ligne des deux côtés" $M15 \
  "  check ((debit = 0) <> (credit = 0))," "  check (true)," \
  "$LB"
prouver "la base qui laisse effacer une écriture validée" $M15 \
  "  if old.statut = 'validee' then" "  if false then" \
  "$LB"
prouver "la base qui laisse bouger les lignes d'une écriture validée" $M15 \
  "  select entreprise, statut into e from compta.ecriture where id = new.ecriture;
  if found and e.statut = 'validee' then" "  select entreprise, statut into e from compta.ecriture where id = new.ecriture;
  if false then" \
  "$LB"
prouver "la base qui accepte une ligne d'une autre entreprise" $M15 \
  "  if not found or e.entreprise <> new.entreprise then" "  if not found then" \
  "$LB"
prouver "la base qui montre les livres au commercial" base/migrations/0019_cabinet.sql \
  "   where (socle.mes_roles(e) && array['proprietaire', 'administrateur', 'comptabilite_interne', 'lecture']::text[]" "   where (socle.mes_roles(e) && array['proprietaire', 'administrateur', 'comptabilite_interne', 'lecture', 'commercial']::text[]" \
  "$LD"
prouver "un commercial qui lit les livres" serveur/compta/gestes.ts \
  "comptabilite_interne: 'oui', lecture: 'voir', supervision: 'oui', revision: 'oui', saisie: 'oui' } }," "comptabilite_interne: 'oui', lecture: 'voir', commercial: 'oui', supervision: 'oui', revision: 'oui', saisie: 'oui' } }," \
  "$LD"
prouver "le grand livre qui repart de zéro à chaque page" serveur/compta/routes.ts \
  "      let solde = await soldeAvant(tx, entreprise, compte, p.du, apres);" "      let solde = await soldeAvant(tx, entreprise, compte, p.du, null);" \
  "$LA"
prouver "le journal qui ne suit pas l'ordre des dates" serveur/compta/routes.ts \
  "        .orderBy('date_ecriture').orderBy('id').limit(n).execute();" "        .orderBy('date_ecriture', 'desc').orderBy('id').limit(n).execute();" \
  "$LA"


# ── Les écritures des achats tenues par le serveur (0016, brique 33) ────────────────────────────
CAS=serveur/compta/achats.ts
VAC=serveur/v10/achats.ts
CAE="chaque achat, chaque imputation d'acompte et chaque règlement fournisseur de l'exemple"
CAH="150 familles tirées au hasard"
CAT="la TVA déductible de chaque mois et les retenues opérées"
LAC="les achats : chaque enregistrement réécrit la famille"
prouver "un avoir rattaché écrit comme un avoir libre (ni le cours de sa facture ni la retenue régularisée)" $CAS \
  "const rattachement = m.nature === 'avoir' && m !== tete" "const rattachement = m.nature === 'avoir' && m === tete" \
  "$CAH"
prouver "un avoir rattaché qui ne régularise pas la retenue déjà opérée" $CAS \
  "regularisationRetenue: filTete.ajustements.get(m.id) ?? 0n }" "regularisationRetenue: 0n }" \
  "$LAC"
prouver "un acompte qui ne couvre sa facture qu'à sa date" $CAS \
  "date: m.nature === 'acompte' ? '' : m.date" "date: m.date" \
  "$CAH"
prouver "une facture qui ne compte pas ce que ses pièces rattachées couvrent" $CAS \
  "retenueAuFil(t.netAPayer, t.netAPayer + t.retenue, liees, regles(tete))" "retenueAuFil(t.netAPayer, t.netAPayer + t.retenue, [], regles(tete))" \
  "$LAC"
prouver "un acompte jamais imputé sur sa facture" $CAS \
  "for (const a of rattachees.filter((m) => m.nature === 'acompte'))" "for (const a of rattachees.filter((m) => m.nature === ('rien' as NatureAchat)))" \
  "$CAE"
prouver "un règlement fournisseur écrit sans sa part de retenue" $CAS \
  "fil.parts.get(r.id) ?? 0n, TND," "0n, TND," \
  "$CAT"
prouver "les règlements d'une pièce rattachée lus au fil de sa facture" $CAS \
  "const fil = fils.get(m.id) as RetenueAuFil;" "const fil = filTete;" \
  "$CAH"
prouver "les écritures d'une famille dans l'ordre de saisie, pas des dates" $CAS \
  ".sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.ordre - y.ordre))" ".sort((x, y) => x.ordre - y.ordre)" \
  "$CAH"
prouver "une pièce toute nulle qui écrit une écriture vide" $CAS \
  "return datees.filter((x) => x.e.lignes.length > 0)" "return datees.filter(() => true)" \
  "$CAH"
prouver "un fournisseur écrit sans son compte auxiliaire" $CAS \
  "fournisseurs: compteFournisseur(plan, m.fournisseur), charges:" "fournisseurs: P.fournisseurs, charges:" \
  "$LAC"
prouver "un règlement fournisseur écrit au journal de banque quoi qu'il arrive" $CAS \
  "const j = journalDeCompte(plan, r.compte, r.mode);" "const j = journalDeCompte(plan, r.compte, 'virement');" \
  "$LAC"
prouver "un avoir détaché que son ancienne famille garde" $VAC \
  "const familles = await famillesDesAchats(tx, entreprise, achats.map((c) => c.cle));" "const familles: string[] = [];" \
  "$LAC"
prouver "une famille sans tête qui ne se vide pas" $CAS \
  "  for (const f of liste) await ecrireFamille(tx, entreprise, f, []);" "" \
  "$LAC"
prouver "un fournisseur renommé dont les écritures gardent l'ancien nom" $VAC \
  "  if (fournisseurs.length) {" "  if (false) {" \
  "$LAC"
prouver "un plan changé qui ne réécrit pas les achats" serveur/v10/dossier.ts \
  "    await reecrireLesAchats(tx, entreprise);" "" \
  "$LAC"
# La contrainte des origines est redéfinie à chaque brique (0016, 0017, 0018) : la preuve vise la
# définition EN VIGUEUR (une preuve qui vise une définition remplacée reste verte : code mort).
# La contrainte des origines est redéfinie par 0021 : ses preuves visent la définition EN VIGUEUR.
# La liste des origines est redéfinie par 0037 (la reprise de la v10) : ces trois preuves visent la dernière.
prouver "la base qui refuse l'origine d'une imputation" base/migrations/0037_compta_reprise_livre_v10.sql \
  "'achat', 'imputation', 'reglement_fournisseur', 'paie'" "'achat', 'reglement_fournisseur', 'paie'" \
  "$LAC"


# ── Les écritures de la paie, en totaux du mois (0017, brique 34) ───────────────────────────────
CPA=serveur/compta/paie.ts
VPA=serveur/v10/paie.ts
PE="chaque mois : la paie, les salaires versés et les avances"
PN="aucun nom de salarié n'entre dans les livres"
PP="un mois se réécrit à chaque geste"
PV="qui ne voit pas la paie ne peut pas en réécrire le brouillard"
prouver "une paie du mois sans les charges patronales" moteur/paie.ts \
  "  poser(comptes.chargesPatronales, b.cnssEmployeur + b.accidentTravail, 'debit');" "  poser(comptes.chargesPatronales, b.cnssEmployeur, 'debit');
  poser(comptes.personnel, b.accidentTravail, 'debit');" \
  "$PE"
prouver "les salaires versés tous portés à la banque" $CPA \
  "    const j = journalDeCompte(plan, p.compte, p.mode ?? '');" "    const j = journalDeCompte(plan, p.compte, 'virement');" \
  "$PP"
prouver "les avances oubliées" $CPA \
  "    if (!lisible(a) || a.date < du || a.date > au) continue;" "    continue;" \
  "$PE"
prouver "une avance comptée dans le mois d'à côté" $CPA \
  "const du = \`\${cleDuMois(m)}-01\`, au = dernierJour(m);" "const du = '0000-01-01', au = '9999-12-31';" \
  "$PE"
prouver "le nom du salarié dans les livres" $CPA \
  "origineType: 'paie', origine: famille, piece, tiers: null, libelle: entree," "origineType: 'paie', origine: famille, piece, tiers: null, libelle: entree + (await tx.query('select nom from paie.salarie where entreprise = \$1 limit 1', [entreprise])).rows.map((r) => ' ' + String(r.nom)).join('')," \
  "$PN"
prouver "un bulletin déplacé que son ancien mois garde" $VPA \
  "    ? (await db.selectFrom('paie.bulletin').select(['annee', 'mois']).where('entreprise', '=', entreprise).where('ref_v10', 'in', bulletins.map((c) => c.cle)).execute())
    : [];" "    ? []
    : [];" \
  "$PP"
prouver "une avance illisible acceptée" $VPA \
  "    if (apres === 'illisible') throw new Refus('v10.avance_illisible');" "" \
  "$PP"
prouver "une avance changée qui ne réécrit pas son mois" $VPA \
  "    for (const a of [avant, apres]) if (a !== null && a !== 'illisible') mois.push(moisDe(a.date));" "" \
  "$PP"
prouver "la paie réécrite par qui ne la voit pas" $CPA \
  "  if (!voit) throw new Error('les écritures de la paie se réécrivent par qui voit la paie');" "" \
  "$PV"
prouver "un plan changé qui ne réécrit pas la paie" serveur/v10/dossier.ts \
  "    await reecrireLaPaie(tx, entreprise);" "" \
  "$PP"
prouver "la base qui refuse l'origine d'une paie du mois" base/migrations/0037_compta_reprise_livre_v10.sql \
  "'reglement_fournisseur', 'paie', 'salaires', 'avance'," "'reglement_fournisseur', 'salaires', 'avance'," \
  "$PE"


# ── La validation des livres (0018, brique 35) ──────────────────────────────────────────────────
M18=base/migrations/0018_compta_validation.sql
VJ="valider numérote et ferme la période"
VC="la chaîne des livres se contrôle"
VD="valider : le propriétaire, l'administrateur, la comptabilité interne"
prouver "une écriture validée que la famille veut telle quelle, contre-passée quand même" $M18 \
  "        trouve := i; exit;" "        exit;" \
  "$VJ"
prouver "une écriture validée comparée sans ses montants" $M18 \
  "from jsonb_array_elements(e->'lignes') with ordinality z(value, n)) = lignes_v then" "from jsonb_array_elements(e->'lignes') with ordinality z(value, n)) is not null then" \
  "$VJ"
prouver "une écriture nouvelle écrite dans la période close" $M18 \
  "greatest((e->>'date')::date, coalesce(v_ouvert, (e->>'date')::date))" "(e->>'date')::date" \
  "$VJ"
prouver "une contre-passation écrite dans la période close" $M18 \
  "greatest(v.date_ecriture, coalesce(v_ouvert, v.date_ecriture))" "v.date_ecriture" \
  "$VJ"
prouver "une contre-passation qui ne change pas les colonnes" $M18 \
  "y.rang, y.compte, y.libelle, y.credit, y.debit, y.taux_tva" "y.rang, y.compte, y.libelle, y.debit, y.credit, y.taux_tva" \
  "$VJ"
prouver "une écriture déjà contre-passée qui se contre-passe encore" $M18 \
  "and c.origine = x.id and c.statut = 'validee')" "and c.origine = x.id and c.statut = 'validee' and false)" \
  "$VJ"
prouver "une contre-passation validée elle-même contre-passée" $M18 \
  "and x.statut = 'validee' and x.origine_type <> 'contre_passation'" "and x.statut = 'validee'" \
  "$VJ"
prouver "une période validée à reculons" base/migrations/0019_cabinet.sql \
  "  if c is not null and p_jusqua <= c then" "  if false then" \
  "$VJ"
prouver "une période validée dans l'avenir" base/migrations/0019_cabinet.sql \
  "  if p_jusqua is null or p_jusqua > aujourdhui then" "  if p_jusqua is null then" \
  "$VJ"
prouver "une validation qui ne ferme pas la période" base/migrations/0019_cabinet.sql \
  "  insert into compta.cloture (entreprise, jusqua, par) values (p_entreprise, p_jusqua, socle.moi())
  on conflict (entreprise) do update set jusqua = excluded.jusqua, par = excluded.par, le = now();" "" \
  "$VJ"
prouver "des numéros qui ne se suivent pas par journal" base/migrations/0019_cabinet.sql \
  "values (p_entreprise, x.journal, extract(year from x.date_ecriture)::int, 1)" "values (p_entreprise, 'XX', extract(year from x.date_ecriture)::int, 1)" \
  "$VJ"
prouver "le contenu scellé sans les lignes" $M18 \
  "(select string_agg(concat_ws(':', l.compte, l.debit::text, l.credit::text, l.libelle), ';' order by l.rang) from compta.ligne l where l.ecriture = e.id)" "''" \
  "$VC"
prouver "le contrôle qui ne recalcule pas le contenu" $M18 \
  "    if x.contenu <> compta.contenu_ecriture(x.id, x.numero) or x.empreinte <> x.empreinte_maillon then" "    if x.empreinte <> x.empreinte_maillon then" \
  "$VC"
prouver "la base qui laisse le commercial valider" base/migrations/0019_cabinet.sql \
  "  elsif not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'comptabilite_interne']::text[]" "  elsif not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'comptabilite_interne', 'commercial']::text[]" \
  "$VD"
prouver "un commercial qui valide" serveur/compta/gestes.ts \
  "  { code: 'compta.ecritures.valider', module: 'compta', ecrit: true, auCabinet: 'comptabilite',
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui', revision: 'oui' } }," "  { code: 'compta.ecritures.valider', module: 'compta', ecrit: true, auCabinet: 'comptabilite',
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui', revision: 'oui', commercial: 'oui' } }," \
  "$VD"


# ── Le cabinet côté serveur (0019, brique 36) ───────────────────────────────────────────────────
M19=base/migrations/0019_cabinet.sql
M32=base/migrations/0032_cabinet_retirer_dossier.sql
M33=base/migrations/0033_cabinet_dossier_tenu_nom.sql
CM="le propriétaire choisit son cabinet par son code"
CT="le dossier tenu : l'associé le crée"
CJ="le cabinet ne fait jamais chez son client ce qui est au client"
prouver "le créateur d'un cabinet qui n'en est pas l'associé" $M19 \
  "values (socle.moi(), v_org, array['supervision']);" "values (socle.moi(), v_org, array['revision']);" \
  "$CM"
prouver "un rôle posé sur un dossier qui ne l'emporte pas" $M19 \
  "                else coalesce(a.role, case when 'supervision' = any(m.roles) then 'supervision' end) end" "                else 'supervision' end" \
  "$CM"
prouver "un cabinet qui agit hors de tout périmètre" $M19 \
  "    when exists (select 1 from socle.membre m where m.utilisateur = socle.moi() and m.actif and m.entreprise = p_entreprise) then null" "    when true then null" \
  "$CM"
prouver "la porte qui ignore le périmètre du mandat" serveur/porte/porte.ts \
  "    if (!ouvrent.some((p) => perimetre.includes(p))) {" "    if (false) {" \
  "$CM"
prouver "la base qui ouvre les livres au cabinet sans la comptabilité" $M19 \
  "          and 'comptabilite' = any(coalesce(socle.perimetre_cabinet(e), '{}')))" "          and true)" \
  "$CM"
prouver "la base qui ouvre la paie au cabinet sans la paie" $M19 \
  "      or (socle.mes_roles(e) && array['supervision', 'paie']::text[] and 'paie' = any(coalesce(socle.perimetre_cabinet(e), '{}')))" "      or (socle.mes_roles(e) && array['supervision', 'paie']::text[])" \
  "$CM"
prouver "un mandat proposé par un autre que le propriétaire" $M19 \
  "  if not ('proprietaire' = any(socle.mes_roles(p_entreprise))) or socle.perimetre_cabinet(p_entreprise) is not null then" "  if false then" \
  "$CM"
prouver "deux cabinets à la fois" $M19 \
  "  if exists (select 1 from socle.mandat d where d.entreprise = p_entreprise and d.statut in ('propose', 'actif')) then" "  if false then" \
  "$CM"
prouver "un mandat accepté par un collaborateur" $M19 \
  "  if not found or not socle.suis_associe(d.cabinet) then perform socle.refus('seul un associé du cabinet accepte un dossier'); end if;" "  if not found then perform socle.refus('seul un associé du cabinet accepte un dossier'); end if;" \
  "$CM"
prouver "un mandat arrêté qui laisse le cabinet voir" $M32 \
  "  update socle.mandat set statut = 'termine', fin = greatest(current_date, debut) where id = p_mandat;" "" \
  "$CM"
prouver "un périmètre changé par le cabinet" $M19 \
  "  if not found or not ('proprietaire' = any(socle.mes_roles(d.entreprise))) or socle.perimetre_cabinet(d.entreprise) is not null then" "  if not found then" \
  "$CM"
prouver "un dossier confié par un collaborateur" $M19 \
  "  if not found or not socle.suis_associe(d.cabinet) then perform socle.refus('seul un associé du cabinet confie un dossier'); end if;
  if not exists" "  if not exists" \
  "$CM"
prouver "un collaborateur qui voit tout le portefeuille" $M19 \
  "     and ('supervision' = any(m.roles) or (a.role is not null and d.statut = 'actif'))" "     and true" \
  "$CM"
prouver "le client qui valide malgré le mandat de comptabilité" $M19 \
  "  elsif v_mandat and ma_cle() is null then" "  elsif false then" \
  "$CM"
prouver "l'assistant de saisie qui valide, dans la base" $M19 \
  "    if not ('comptabilite' = any(v_perimetre) and socle.mes_roles(p_entreprise) && array['supervision', 'revision']::text[]) then" "    if false then" \
  "$CM"
prouver "l'assistant de saisie qui valide, à la porte" serveur/compta/gestes.ts \
  "  { code: 'compta.ecritures.valider', module: 'compta', ecrit: true, auCabinet: 'comptabilite',
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui', revision: 'oui' } }," "  { code: 'compta.ecritures.valider', module: 'compta', ecrit: true, auCabinet: 'comptabilite',
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui', revision: 'oui', saisie: 'oui' } }," \
  "$CM"
prouver "un dossier tenu créé par un collaborateur" $M33 \
  "  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet crée un dossier'); end if;" "" \
  "$CT"
prouver "un dossier tenu sans tout son périmètre" $M33 \
  "array['comptabilite', 'declarations', 'saisie_achats', 'paie'], 'actif');" "array['comptabilite'], 'actif');" \
  "$CT"
prouver "un matricule mal formé qui fait tomber le serveur" serveur/cabinet/routes.ts \
  '      if (matricule === undefined) return refusDuMatricule(corps.matriculeFiscal);
      const id = (await tx.query('\''select socle.creer_dossier_tenu(' '      const id = (await tx.query('\''select socle.creer_dossier_tenu(' \
  "$CT"
prouver "les pièces de vente fermées au cabinet de comptabilité" serveur/porte/porte.ts \
  "  compta: ['comptabilite'], ventes: ['comptabilite']," "  compta: ['comptabilite'], ventes: []," \
  "$CJ"

# ── Brique 37 : les écrans du Cabinet (docs/cabinet.md) ──
M20=base/migrations/0020_cabinet_fiches.sql
PC=web/public/plateforme/pont-cabinet.js
E1="« Ton cabinet comptable » : le client lit le nom et le code de son cabinet, rien de plus ; personne d'autre ne les lit par ce chemin"
E2="l'entrée sait ce qui est à la personne et ce qu'elle voit par son cabinet"
E3="la fiche d'un dossier : au cabinet seul, champs comptés, jamais écrasée par un poste qui ne l'a pas relue"
W1="la session ouvre le cabinet ; ses dossiers sont le portefeuille du serveur ; le livre d'un client est celui du serveur"
W2="« je suis un cabinet comptable » sur la porte : le cabinet se crée, le code du téléphone se pose, le Cabinet s'ouvre ; « Verrouiller » ferme la session"
W3="le client confie son dossier par le code que le Cabinet affiche ; l'associé accepte sur sa page Dossiers ; le client arrête le mandat après confirmation"
prouver "le compte qui confond ses entreprises et celles de son cabinet" serveur/routes/socle.ts \
  'socle.perimetre_cabinet(e.id) is not null "parCabinet"' 'false "parCabinet"' \
  "$E2"
prouver "le nom du cabinet lu par n'importe qui" $M20 \
  "   where d.id = p_mandat and d.entreprise in (select socle.mes_entreprises())" "   where d.id = p_mandat" \
  "$E1"
prouver "le client qui ne lit pas le nom de son cabinet" serveur/cabinet/routes.ts \
  "(await tx.query('select nom, code from socle.cabinet_du_mandat(\$1)', [d.id])).rows[0]" "(await tx.query('select nom, code_cabinet code from socle.organisation where id = \$1', [d.cabinet])).rows[0]" \
  "$E1"
prouver "une fiche écrasée par un poste qui ne l'a pas relue" serveur/cabinet/routes.ts \
  "      if (connue !== corps.revision) return { statut: 409, corps: { motif: motif('cabinet.fiche_changee'), revision: connue } };" "" \
  "$E3"
prouver "deux postes qui enregistrent la même fiche au même instant" serveur/cabinet/routes.ts \
  ".where('entreprise', '=', entreprise).where('revision', '=', BigInt(connue ?? 0))" ".where('entreprise', '=', entreprise)" \
  "$E3"
prouver "une fiche lue sans voir le dossier" $M20 \
  "  using (cabinet in (select socle.mes_organisations()) and entreprise in (select socle.mes_entreprises()));" "  using (cabinet in (select socle.mes_organisations()));" \
  "$E3"
prouver "une fiche aux champs non comptés" serveur/cabinet/routes.ts \
  "REGIME_DE_CONTRAT) }).strict(),
}).partial().strict();" "REGIME_DE_CONTRAT) }).strict(),
}).partial().passthrough();" \
  "$E3"
prouver "l'entrée qui ouvre l'entreprise d'un client comme la sienne" web/src/App.tsx \
  "    const siennes = moi.entreprises.filter((x) => !x.parCabinet);" "    const siennes = moi.entreprises;" \
  "$W1"
prouver "« Tes premiers pas » qui réclame encore l'appairage et la clé de secours" $PC \
  "const ETAPES_ABSENTES = ['decouverte', 'appairage', 'cle', 'copie'];" "const ETAPES_ABSENTES = [];" \
  "$W2"
prouver "les réglages de la boîte de réception et des sauvegardes sur l'ordinateur" $PC \
  "const PANNEAUX_ABSENTS = ['pan-licence', 'pan-inbox', 'pan-backup', 'pan-maj', 'pan-exemple', 'pan-comptes'];" "const PANNEAUX_ABSENTS = ['pan-licence', 'pan-maj'];" \
  "$W2"
prouver "« Verrouiller » qui laisse la session ouverte" $PC \
  "      try { await fetch('/v1/deconnexion', { method: 'POST', headers: { authorization: \`Bearer \${jeton}\` } }); } catch { /* la session se ferme de toute façon ici */ }" "" \
  "$W2"
prouver "un dossier confié qui ne s'annonce pas au cabinet" $PC \
  "    proposes = (porte.dossiers || []).filter((/** @type {any} */ d) => d.statut === 'propose');" "    proposes = [];" \
  "$W3"
prouver "le Cabinet qui affiche un autre code que le sien" $PC \
  "    code = String(cab.code || '');" "    code = String(cab.id || '');" \
  "$W3"
prouver "un mandat arrêté sans le demander" web/public/plateforme/pont.js \
  "      if (m.statut === 'actif' && !b.dataset.confirme) {" "      if (false) {" \
  "$W3"
prouver "la balance du Cabinet qui n'est pas celle du serveur" $PC \
  "debit: nombre(l.debit), credit: nombre(l.credit)" "debit: nombre(l.credit), credit: nombre(l.debit)" \
  "$W1"

# ── Brique 38 : la saisie du cabinet dans les livres du serveur (docs/cabinet.md) ──
M21=base/migrations/0021_compta_saisie.sql
S1="saisir au brouillard avec les contrôles de la v10, modifier sans écraser un autre poste, supprimer ; une écriture née d'une pièce ne se change pas"
S2="qui saisit : la comptabilité de l'entreprise et tout le cabinet ; ni la lecture, ni un cabinet sans la comptabilité, ni dans la base"
S3="valider une écriture ou un lot : le numéro de son journal et le maillon de la chaîne ; une écriture datée de demain est nommée sans trouer la numérotation ; l'assistant et le client ne valident pas"
S4="contre-passer et extourner une écriture saisie : le miroir validé, jamais dans la période close ; une écriture née d'une pièce se corrige dans sa pièce"
S5="lettrer une facture et son règlement : la somme fait zéro, sinon l'écart est dit ; un brouillard ne se lettre pas ; délettrer"
S6="les mois du portefeuille disent ce que disent les livres : écritures, brouillards, chiffre d'affaires (deux chemins, un chiffre)"
W38="le portefeuille compte les mois du serveur ; la grille saisit, valide ; le livre-journal contre-passe ; le lettrage automatique lettre ; la balance reste celle du serveur"
prouver "la base qui refuse l'origine d'une écriture saisie" base/migrations/0037_compta_reprise_livre_v10.sql \
  "'contre_passation', 'saisie', 'extourne', 'reprise_v10'));" "'contre_passation', 'extourne', 'reprise_v10'));" \
  "$S1"
prouver "une saisie déséquilibrée qui entre" $M21 \
  "  if td <> tc then" "  if false then" \
  "$S1"
prouver "une saisie dans la période close" $M21 \
  "  if c is not null and v_date <= c then
    perform socle.refus(format('la période est validée jusqu''au %s : une écriture ne s''y écrit plus'" "  if false then
    perform socle.refus(format('la période est validée jusqu''au %s : une écriture ne s''y écrit plus'" \
  "$S1"
prouver "un compte qui n'est pas un numéro" $M21 \
  "    if coalesce(l->>'compte', '') !~ '^[0-9]{1,12}\$' then perform socle.refus(format('ligne %s : le compte doit être un numéro', i)); end if;" "" \
  "$S1"
prouver "une écriture sans libellé" $M21 \
  "  if v_libelle is null then perform socle.refus('le libellé manque : écris-le sur la pièce ou sur une ligne'); end if;" "" \
  "$S1"
prouver "un brouillard écrasé par un poste qui ne l'a pas relu" $M21 \
  "  if x.revision <> p_revision then" "  if false then" \
  "$S1"
prouver "le changé-ailleurs rendu en erreur du serveur" serveur/app.ts \
  "err.code === 'perimee' || err.code === 'SK409'" "err.code === 'perimee'" \
  "$S1"
prouver "une écriture née d'une pièce changée dans les livres" $M21 \
  "  if x.origine_type <> 'saisie' then
    perform socle.refus('cette écriture vient d''une pièce de l''entreprise : elle suit sa pièce" "  if false then
    perform socle.refus('cette écriture vient d''une pièce de l''entreprise : elle suit sa pièce" \
  "$S1"
prouver "la lecture qui saisit, dans la base" $M21 \
  "    else socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'comptabilite_interne']::text[]" "    else true" \
  "$S2"
prouver "un cabinet sans la comptabilité qui saisit" $M21 \
  "      'comptabilite' = any(socle.perimetre_cabinet(p_entreprise))
      and" "      true
      and" \
  "$S2"
prouver "l'assistant de saisie qui valide des écritures, dans la base" $M21 \
  "else array['supervision', 'revision']::text[] end" "else array['supervision', 'revision', 'saisie']::text[] end" \
  "$S3"
prouver "l'assistant de saisie qui valide des écritures, à la porte" serveur/compta/gestes.ts \
  "  { code: 'compta.ecritures.valider', module: 'compta', ecrit: true, auCabinet: 'comptabilite',
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui', revision: 'oui' } }," "  { code: 'compta.ecritures.valider', module: 'compta', ecrit: true, auCabinet: 'comptabilite',
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui', revision: 'oui', saisie: 'oui' } }," \
  "$S3"
prouver "le client qui valide des écritures malgré le mandat" $M21 \
  "      and (p_geste <> 'compta.ecritures.valider' or not exists (" "      and (true or not exists (" \
  "$S3"
prouver "une écriture validée avant son jour" $M21 \
  "    if x.date_ecriture > aujourdhui then" "    if false then" \
  "$S3"
prouver "une écriture revalidée" $M21 \
  "    if x.statut <> 'brouillard' then
      pourquoi :=" "    if false then
      pourquoi :=" \
  "$S3"
prouver "une contre-passation dans la période close" $M21 \
  "  v_date := greatest(coalesce(p_date, aujourdhui), x.date_ecriture, coalesce(c + 1, x.date_ecriture));" "  v_date := greatest(coalesce(p_date, aujourdhui), x.date_ecriture);" \
  "$S4"
prouver "une écriture née d'une pièce contre-passée à la main" $M21 \
  "  if x.origine_type not in ('saisie', 'extourne') then" "  if false then" \
  "$S4"
prouver "une écriture contre-passée deux fois" $M21 \
  "  if exists (select 1 from compta.ecriture k where k.entreprise = p_entreprise and k.origine_type = 'contre_passation' and k.origine = x.id) then
    perform socle.refus('cette écriture a déjà été contre-passée');" "  if false then
    perform socle.refus('cette écriture a déjà été contre-passée');" \
  "$S4"
prouver "un miroir aux lignes non inversées" $M21 \
  "y.libelle, y.credit, y.debit, y.taux_tva" "y.libelle, y.debit, y.credit, y.taux_tva" \
  "$S4"
prouver "une extourne dans la période close" $M21 \
  "  if c is not null and v_date <= c then
    perform socle.refus(format('son extourne tomberait" "  if false then
    perform socle.refus(format('son extourne tomberait" \
  "$S4"
prouver "une écriture extournée deux fois" $M21 \
  "    perform socle.refus('cette écriture a déjà été extournée');" "" \
  "$S4"
prouver "un lettrage qui ne se solde pas" $M21 \
  "  if solde <> 0 then perform socle.refus(" "  if false then perform socle.refus(" \
  "$S5"
prouver "un brouillard lettré" $M21 \
  "  if exists (select 1 from compta.ecriture e where e.id = any (p_ecritures) and e.statut <> 'validee') then" "  if false then" \
  "$S5"
prouver "une ligne lettrée deux fois" $M21 \
  "    perform socle.refus('une de ces lignes est déjà lettrée : délettre-la d''abord');" "" \
  "$S5"
prouver "deux lettrages simultanés qui se heurtent" $M21 \
  "  perform pg_advisory_xact_lock(hashtextextended('compta.lettrage:' || p_entreprise::text, 0));" "" \
  "$S5"
prouver "l'assistant de saisie qui lettre, à la porte" serveur/compta/gestes.ts \
  "  { code: 'compta.lettrage.poser', module: 'compta', ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui', revision: 'oui' } }," "  { code: 'compta.lettrage.poser', module: 'compta', ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui', revision: 'oui', saisie: 'oui' } }," \
  "$S5"
prouver "la lettre absente du journal" serveur/compta/routes.ts \
  "lettre: lettres.get(l.id) ?? null," "lettre: null," \
  "$S5"
# Les mois du portefeuille : la fonction de la 0021 est remplacée par celle de la 0022 (brique 39, les
# à-nouveaux n'écrivent aucun mois) ; c'est celle-là qui compte.
prouver "le chiffre d'affaires du mois sans les avoirs" base/migrations/0022_compta_exercice.sql \
  "select sum(l.credit - l.debit) ca from compta.ligne l" "select sum(l.credit) ca from compta.ligne l" \
  "$S6"
prouver "les brouillards du mois mal comptés" base/migrations/0022_compta_exercice.sql \
  "count(*) filter (where e.statut = 'brouillard')" "count(*)" \
  "$S6"
prouver "une écriture saisie prise pour une pièce du client" web/public/plateforme/pont-cabinet.js \
  "      if (e.origine.type === 'saisie' || e.origine.type === 'extourne') return 'saisie';" "" \
  "$W38"
prouver "le brouillard d'une pièce du client proposé à la reprise" web/public/v10/cabinet/app.js \
  "      if (e.source !== 'skanfact') a.push({ icon: 'modifier', label: 'Reprendre dans la grille'," "      a.push({ icon: 'modifier', label: 'Reprendre dans la grille'," \
  "$W38"
prouver "un mois au brouillard compté comme définitif" web/public/plateforme/pont-cabinet.js \
  "definitive: m.brouillards === 0," "definitive: true," \
  "$W38"
prouver "le lettrage automatique qui ne pose rien au serveur" web/public/plateforme/pont-cabinet.js \
  "        const l = await appel('POST', \`/entreprises/\${o.dossierId}/compta/lettrages\`, { compte: String(o.compte), ecritures: p.ecritures });" "        const l = { lettre: p.lettre };" \
  "$W38"

# ── Brique 38 bis : le Cabinet sans paquets, dans les mots et les gestes (docs/cabinet.md, C14, C15) ──
CC=web/public/v10/cabinet/cabcore.js
CA=web/public/v10/cabinet/app.js
CG=web/public/v10/cabinet/cabguide.js
CVI=web/public/v10/cabinet/cabvisites.js
R1="un mois vide se relance, un mois au brouillard se valide ; la relance part dans la messagerie et se note dans la fiche"
MO1="chaque écran du Cabinet, et chaque bulle qu'il porte, se lit sans un mot de paquet"
TX1="chaque visite proposée en ligne, chaque écran, bouton et champ qu'une visite explique, se lit sans un mot de paquet"
TX2="chaque bulle « i » et chaque article de l'Aide se lit sans un mot de paquet"
TX3="ce qui est déclaré « jamais montré » existe encore : une liste qui nomme un disparu ne protège rien"
prouver "un mois au brouillard relancé chez le client" $CC \
  "    return dossierList(state, todayIso).filter(r => r.missingCount > 0);" "    return dossierList(state, todayIso).filter(r => r.missingCount > 0 || r.provisionalCount > 0);" \
  "$R1"
prouver "le mail de relance qui réclame encore un paquet" $CC \
  "'\nIl vous suffit de les enregistrer dans SkanFact" "'\nFabriquez le paquet du mois et envoyez-le-moi" \
  "$R1"
prouver "une relance qui ne s'ouvre pas dans la messagerie" $PC \
  "      ouvrirLien(u.url);" "" \
  "$R1"
prouver "une relance qui n'est pas notée au serveur" $PC \
  "      await poserFiche(id, { ...avant, relances: [...deja, relance].slice(-50) }, f ? f.revision : null);" "      void relance;" \
  "$R1"
prouver "« Valider » qui mène aux relances au lieu de la saisie" $CA \
  "      location.hash = '#/dossier/' + encodeURIComponent(d.id) + '/comptabilite/saisie/' + m.slice(0, 4);" "      location.hash = '#/relances';" \
  "$R1"
prouver "un mois écrit qui ouvre un paquet" $CA \
  "        const m = c.dataset.m, aValider = c.classList.contains('provisoire');" "        const m = c.dataset.m, aValider = c.classList.contains('provisoire'); if (m) return openPack(dossier, m);" \
  "$R1"
prouver "l'état d'un dossier qui dit encore « provisoire »" $CA \
  "pl(row.provisionalCount, 'mois à valider', 'mois à valider')" "pl(row.provisionalCount, 'provisoire')" \
  "$R1"
prouver "la fiche qui refuse les relances" serveur/cabinet/routes.ts \
  "  relances: z.array(RELANCE).max(50)," "" \
  "$E3"
prouver "une relance au moyen inventé" serveur/cabinet/routes.ts \
  "via: z.enum(['email', 'tel', 'whatsapp', 'autre'])," "via: z.string()," \
  "$E3"
prouver "une relance aux mois mal écrits" serveur/cabinet/routes.ts \
  "months: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).max(120)," "months: z.array(z.string()).max(120)," \
  "$E3"
prouver "plus de cinquante relances gardées" serveur/cabinet/routes.ts \
  "  relances: z.array(RELANCE).max(50)," "  relances: z.array(RELANCE).max(500)," \
  "$E3"
prouver "une relance qui porte un champ de plus" serveur/cabinet/routes.ts \
  "note: texte(500),
}).strict();" "note: texte(500),
});" \
  "$E3"
prouver "« Tenir un premier livre » caché des premiers pas" $PC \
  "const ETAPES_ABSENTES = ['decouverte', 'appairage', 'cle', 'copie'];" "const ETAPES_ABSENTES = ['decouverte', 'appairage', 'cle', 'copie', 'travail'];" \
  "$W2"
prouver "un mot de paquet revenu sur le portefeuille" $CA \
  "    p.paquets ? pl(p.paquets, 'mois écrit', 'mois écrits') : 'aucun mois écrit'," "    p.paquets ? pl(p.paquets, 'paquet') + ' reçu' + (p.paquets > 1 ? 's' : '') : 'aucun paquet reçu'," \
  "$MO1"
prouver "la clé de secours réclamée en ligne" $PC \
  "    sansCleDeSecours: true," "" \
  "$MO1"
prouver "la clé de secours réclamée par l'écran" $CA \
  "    if (api.sansCleDeSecours === true) return Promise.resolve();" "" \
  "$MO1"
prouver "une bulle visible qui parle encore de paquets" $CG \
  "Pour un client sur SkanFact, ce sont <b>les mêmes livres que les siens</b>" "Pour un client sur SkanFact, <b>à partir des paquets reçus</b>" \
  "$MO1"
prouver "une visite qui parle encore de paquets" $CVI \
  "texte: 'Chaque client sur SkanFact dont un mois passé n\\'a aucune écriture. Le mois en cours n\\'est jamais réclamé.' }," "texte: 'Chaque client qui ne t\\'a pas envoyé un mois terminé, ou seulement du provisoire. Le mois en cours n\\'est jamais réclamé.' }," \
  "$TX1"
prouver "une visite sans objet proposée en ligne" $PC \
  "'copie-externe', 'recevoir-paquet', 'lire-paquet'," "'copie-externe', 'lire-paquet'," \
  "$TX1"
prouver "un article de l'Aide qui parle encore de paquets" $CG \
  "      <p class=\"small\">Un mois est <b>validé</b> quand plus aucune" "      <p class=\"small\">Un paquet est <b>validé</b> quand plus aucune" \
  "$TX2"
prouver "un article sans objet proposé en ligne" $PC \
  "const ARTICLES_ABSENTS = ['filets', 'demenager', 'licence', 'maj'];" "const ARTICLES_ABSENTS = ['demenager', 'licence', 'maj'];" \
  "$TX2"
prouver "une liste « jamais montré » qui nomme un disparu" $CG \
  "    'lic.cle': {" "    'lic.clef': {" \
  "$TX3"

# ── Brique 39 : l'exercice et sa balance d'ouverture ; la reprise d'un client (docs/cabinet.md, C16, C17) ──
M22=base/migrations/0022_compta_exercice.sql
EXS=serveur/compta/exercice.ts
EX1="la balance d'ouverture : une écriture AN au premier jour, validée d'un geste avec l'exercice, ou rien ; l'exercice s'ouvre une fois ; fausse, elle se contre-passe"
EX2="un premier exercice qui commence en cours d'année, sans balance ; une balance datée d'un jour à venir, ou dans la période validée, ne s'ouvre pas ; deux ouvertures au même instant, une seule passe"
RP1="un client tenu commence son livre avec la balance d'un CSV ; un client sur SkanFact reprend ses soldes depuis Excel, refusés tant qu'ils ne tombent pas juste"
prouver "l'exercice ouvert par l'assistant de saisie, à la porte" $EXS \
  "geste: 'compta.ecritures.valider', corps: OUVRIR," "geste: 'compta.ecritures.saisir', corps: OUVRIR," \
  "$EX1"
prouver "l'exercice ouvert par qui ne valide pas, dans la base" $M22 \
  "  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');" "  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');" \
  "$EX1"
prouver "l'exercice lu par la voisine" $M22 \
  "create policy visible on compta.exercice using (entreprise in (select compta.mes_entreprises()));" "create policy visible on compta.exercice using (true);" \
  "$EX1"
prouver "un exercice qui commence avant le 1er janvier" $M22 \
  "  if p_du is null or p_du < make_date(p_annee, 1, 1) then" "  if p_du is null then" \
  "$EX1"
prouver "un exercice qui commence après sa fin" $M22 \
  "  if p_du > v_au then perform socle.refus(" "  if false then perform socle.refus(" \
  "$EX1"
prouver "un exercice ouvert deux fois" $M22 \
  "  if not found then
    perform socle.refus(format('l''exercice %s est déjà ouvert" "  if false then
    perform socle.refus(format('l''exercice %s est déjà ouvert" \
  "$EX1"
prouver "une balance d'ouverture laissée au brouillard" $M22 \
  "    select * into v from compta.valider_ecritures(p_entreprise, array[v_id]);" "    select null::text as r_motif, null::text as r_numero into v;" \
  "$EX1"
prouver "une balance d'ouverture qui ne se valide pas, ouverte quand même" $M22 \
  "    if v.r_motif is not null then perform socle.refus(format('la balance d''ouverture ne se valide pas : %s', v.r_motif)); end if;" "" \
  "$EX2"
prouver "une balance d'ouverture ailleurs qu'au premier jour" $M22 \
  "jsonb_build_object('date', p_du, 'journal', 'AN'" "jsonb_build_object('date', p_du + 1, 'journal', 'AN'" \
  "$EX1"
prouver "une ouverture sans sa trace" $M22 \
  "  perform socle.tracer(p_entreprise, 'compta.exercice.ouvrir', 'exercice', v_id, null,
    jsonb_build_object('annee', p_annee, 'du', p_du, 'au', v_au, 'ouverture', v_id));" "" \
  "$EX1"
prouver "une rangée laissée blanche refusée" $EXS \
  "    const pleines = corps.ouverture.filter((l) => l.compte.trim() || (l.debit ?? '').trim() || (l.credit ?? '').trim());" "    const pleines = corps.ouverture;" \
  "$EX1"
prouver "les à-nouveaux qui écrivent janvier au portefeuille" $M22 \
  "     and e.journal <> 'AN'
" "" \
  "$EX1"
prouver "les soldes d'ouverture qu'on ne peut pas reprendre depuis le livre" $CA \
  "\${api.exerciceOuvert(dossier.id, s.annee) === true ? '' :" "\${api.exerciceOuvert(dossier.id, s.annee) !== undefined ? '' :" \
  "$RP1"
prouver "un bouton de reprise qui ne mène nulle part" $CA \
  "    const ov = \$('#lv-ouvrir'); if (ov) ov.onclick = () => repriseForm(root, dossier);" "" \
  "$RP1"
prouver "le bouton de reprise qui reste une fois l'exercice ouvert" $PC \
  "    exerciceOuvert: (/** @type {string} */ id, /** @type {string} */ annee) => !!exerciceDe(id, annee)," "    exerciceOuvert: () => false," \
  "$RP1"
prouver "« Commencer le livre » d'un livre qui a des écritures" $CA \
  "\${livreTenu ? 'Reprendre les soldes d\\'ouverture de' : 'Commencer le livre de'}" "Commencer le livre de" \
  "$RP1"
prouver "« Créer le livre » pour ouvrir un exercice" $CA \
  "\${livreTenu ? 'Ouvrir l\\'exercice' : 'Créer le livre'}" "Créer le livre" \
  "$RP1"
prouver "« Livre créé » pour un exercice ouvert" $CA \
  "toast(livreTenu ? \`Exercice \${v.annee} ouvert\` : \`Livre de \${v.annee} créé\`);" "toast(\`Livre de \${v.annee} créé\`);" \
  "$RP1"
# Le lecteur des classeurs est partagé par l'entreprise et le Cabinet depuis la brique 85 (tableur.js).
prouver "une balance Excel refusée" web/public/plateforme/tableur.js \
  "      try { entrees = await dezipper(octets); } catch (e) {" "      try { entrees = null; } catch (e) {" \
  "$RP1"
prouver "un classeur dont une entrée gonfle sans limite" web/public/plateforme/tableur.js \
  "  const MAX_ENTREE = 20 * 1024 * 1024;" "  const MAX_ENTREE = 2000 * 1024 * 1024;" \
  "$RP1"
prouver "un classeur qui gonfle sans limite au total" web/public/plateforme/tableur.js \
  "  const MAX_CLASSEUR = 60 * 1024 * 1024;" "  const MAX_CLASSEUR = 6000 * 1024 * 1024;" \
  "$RP1"
prouver "le refus d'un classeur trop gros avalé" web/public/plateforme/tableur.js \
  "        if (e instanceof Error && e.message === TROP_GROS) return { ok: false, motif: TROP_GROS };
" "" \
  "$RP1"
prouver "les feuilles d'un classeur lues sans être décompressées" web/public/plateforme/tableur.js \
  "(methode === 8 ? await inflater(corps, MAX_CLASSEUR - lu) : corps.slice())" "corps.slice()" \
  "$RP1"
prouver "une balance d'ouverture perdue en route" $PC \
  "...(o.du ? { du: String(o.du) } : {}), ouverture });" "...(o.du ? { du: String(o.du) } : {}), ouverture: [] });" \
  "$RP1"
prouver "un premier exercice qui commence toujours le 1er janvier" $PC \
  "{ annee: Number(o.annee), ...(o.du ? { du: String(o.du) } : {}), ouverture }" "{ annee: Number(o.annee), ouverture }" \
  "$RP1"
prouver "un exercice ouvert sans écriture qui n'a pas de livre" $PC \
  "      if (!ecritures.length && !exerciceDe(id, annee)) return { dossier: d, livre: null };" "      if (!ecritures.length) return { dossier: d, livre: null };" \
  "$RP1"
prouver "l'année d'un exercice ouvert absente de la liste" $PC \
  ", ...ouverts.map((x) => String(x.du).slice(0, 7))])].sort();" "])].sort();" \
  "$RP1"
prouver "les bornes d'un exercice que le livre ignore" $PC \
  "      livre.exercice.du = ex.du; livre.exercice.au = ex.au;" "" \
  "$RP1"
prouver "« Aucun paquet reçu » revenu sur le livre vide" $CA \
  "        : 'Aucune écriture pour l\\'instant.'}</b>" "        : 'Aucun paquet reçu pour l\\'instant.'}</b>" \
  "$RP1"
prouver "un mois au brouillard réclamé par le livre" $CA \
  "KC.lignesDuLivre(s.livre, { brouillard: true }).filter(l => l.journal !== 'AN');" "KC.lignesDuLivre(s.livre, { brouillard: s.brouillard }).filter(l => l.journal !== 'AN');" \
  "$RP1"
prouver "la balance d'ouverture qui écrit janvier dans le livre" $CA \
  "KC.lignesDuLivre(s.livre, { brouillard: true }).filter(l => l.journal !== 'AN');" "KC.lignesDuLivre(s.livre, { brouillard: true });" \
  "$RP1"
prouver "« Écrire au client » qui parle encore de paquets" $CVI \
  "Écrit au client qu\\'aucune pièce n\\'est encore enregistrée" "Écrit au client qu\\'aucun paquet n\\'est arrivé" \
  "$TX1"

# ── Brique 39 bis : les écritures par tableur, l'aller-retour (docs/cabinet.md, C18) ──
SAI=serveur/compta/saisie.ts
IM1="un lot : chaque pièce entre, ou remplace un brouillard, ou est nommée avec sa raison sans laisser de trace ; qui ne saisit pas n'importe rien"
IM2="corriger une validée : sa contre-passation et sa version corrigée, d'un geste, ou rien ; l'assistant ne corrige pas ; une écriture née d'une pièce se corrige dans sa pièce"
TB1="le livre-journal s'exporte en CSV, se corrige dans un tableur et se réimporte : ce qui entre, ce qui se contre-passe, ce qui est refusé ; le FEC se télécharge sans les brouillards"
prouver "un lot sans point de reprise : une pièce refusée emporte les autres" $SAI \
  "          await tx.query('rollback to savepoint piece');" "" \
  "$IM1"
prouver "un lot ouvert à qui ne saisit pas" $SAI \
  "methode: 'POST', chemin: '/entreprises/:entreprise/compta/ecritures/lot', geste: 'compta.ecritures.saisir'," "methode: 'POST', chemin: '/entreprises/:entreprise/compta/ecritures/lot', geste: 'socle.accueil.voir'," \
  "$IM1"
prouver "un lot sans borne" $SAI \
  "}).strict()).min(1).max(500, { message: 'compta.champ.ids' })," "}).strict()).min(1).max(5000, { message: 'compta.champ.ids' })," \
  "$IM1"
prouver "un brouillard remplacé sans que sa révision compte" $SAI \
  "p.remplace.id, p.remplace.revision, e.json]" "p.remplace.id, 2, e.json]" \
  "$IM1"
prouver "une validée corrigée par l'assistant de saisie" $SAI \
  "methode: 'POST', chemin: '/entreprises/:entreprise/compta/ecritures/:ecriture/corriger', geste: 'compta.ecritures.valider'," "methode: 'POST', chemin: '/entreprises/:entreprise/compta/ecritures/:ecriture/corriger', geste: 'compta.ecritures.saisir'," \
  "$IM2"
prouver "une validée contre-passée sans sa version corrigée" $SAI \
  "      const id = (await tx.query('select compta.saisir(\$1, \$2::jsonb) id', [params.entreprise ?? '', e.json])).rows[0].id as string;
      return { statut: 201, corps: { miroir:" "      await tx.query('savepoint v'); let id = ''; try { id = (await tx.query('select compta.saisir(\$1, \$2::jsonb) id', [params.entreprise ?? '', e.json])).rows[0].id as string; } catch { await tx.query('rollback to savepoint v'); }
      return { statut: 201, corps: { miroir:" \
  "$IM2"
prouver "une pièce du tableur qui ne tombe pas juste envoyée au serveur" $PC \
  "      if (!cle || KC.round3(p.ecart) === 0) continue;" "      if (!cle || true) continue;" \
  "$TB1"
prouver "les comptes d'une pièce refusée annoncés au plan" $PC \
  "    a.comptesNouveaux = [...new Set(a.pieces.filter(" "    void [...new Set(a.pieces.filter(" \
  "$TB1"
prouver "un brouillard corrigé au tableur qui entre en double" $PC \
  "envois.push({ p, piece: { ecriture: pieceVersLeServeur(p), remplace: { id: p.cibleId, revision: revisions.get(p.cibleId) ?? 1 } } });" "envois.push({ p, piece: { ecriture: pieceVersLeServeur(p) } });" \
  "$TB1"
prouver "une validée corrigée sans être contre-passée" $PC \
  "            await appel('POST', \`/entreprises/\${id}/compta/ecritures/\${p.cibleId}/corriger\`, { date: KC.dateDuMiroir(livre, cible, K.today()), ecriture: pieceVersLeServeur(p) });" "            await appel('POST', \`/entreprises/\${id}/compta/ecritures\`, pieceVersLeServeur(p));" \
  "$TB1"
prouver "la case « contre-passer » sans effet" $PC \
  "      if (corriger) {
        for (const p of a.pieces.filter(" "      if (false) {
        for (const p of a.pieces.filter(" \
  "$TB1"
prouver "le CSV sans le BOM qu'Excel attend" $PC \
  "\`\\uFEFF\${String(texte || '')}\`" "String(texte || '')" \
  "$TB1"
prouver "le CSV sous un nom de fichier brut" $PC \
  "telecharger(\`\${slug(nom || 'dossiers')}.csv\`" "telecharger(\`\${nom}.csv\`" \
  "$TB1"
prouver "le FEC qui ne se télécharge pas" $PC \
  "    exportFec: async (" "    exportFecAbsent: async (" \
  "$TB1"
prouver "la visite « Commencer le livre » encore cachée en ligne" $PC \
  "  const VISITES_PAS_ENCORE = [
" "  const VISITES_PAS_ENCORE = [
    'premier-livre',
" \
  "$TB1"
prouver "la visite « Commencer le livre » qui choisit un client sur SkanFact" $CVI \
  "      const libre = d => !!d && !!d.manual && !d.demo" "      const libre = d => !!d && !d.demo" \
  "$TB1"

# ── Brique 40 : la banque, relevés et rapprochements (docs/cabinet.md, C19 à C21) ──
M23=base/migrations/0023_compta_banque.sql
BQS=serveur/compta/banque.ts
CRT=serveur/cabinet/routes.ts
BQ1="un relevé s'importe s'il se boucle, une fois, avec son compte ; ses lignes se lisent au millime ; une voisine n'en lit rien"
BQ2="un rapprochement : une ligne du relevé, une ligne d'écriture du même compte, qui ne répond que d'elle ; un brouillard qui change le fait tomber ; tout se défait, le relevé se retire"
BQ3="les réglages du cabinet : les banques et les mots retenus, rien d'autre ; changés ailleurs, jamais écrasés ; un autre cabinet n'y lit rien"
WB1="un relevé s'importe, l'automatique pose le certain et garde l'ambiguïté, qui se tranche à la main ; l'écriture manquante s'écrit depuis la ligne ; tout se défait, le relevé se retire"
prouver "un relevé qui ne se boucle pas, importé" $M23 \
  "  if v_debut + v_somme <> v_fin then" "  if false then" \
  "$BQ1"
prouver "le même fichier de relevé importé deux fois" $M23 \
  "  if found then
    perform socle.refus(format('ce fichier a déjà été importé" "  if false then
    perform socle.refus(format('ce fichier a déjà été importé" \
  "$BQ1"
prouver "un relevé sans compte bancaire" $M23 \
  "  if coalesce(p_releve->>'compte', '') !~ '^[0-9]{1,12}\$' then" "  if false then" \
  "$BQ1"
prouver "un relevé sans ligne" $M23 \
  "  if v_n = 0 then perform socle.refus('ce relevé ne porte aucune ligne lisible'); end if;" "" \
  "$BQ1"
prouver "les relevés que la voisine lit" $M23 \
  "create policy visible on compta.releve using (entreprise in (select compta.mes_entreprises()));" "create policy visible on compta.releve using (true);" \
  "$BQ1"
prouver "les lignes de relevé que la voisine lit" $M23 \
  "create policy visible on compta.releve_ligne using (entreprise in (select compta.mes_entreprises()));" "create policy visible on compta.releve_ligne using (true);" \
  "$BQ1"
prouver "un montant de relevé illisible accepté" $BQS \
  "        if (m === null) return champInvalide(\`lignes.\${i}.montant\`, t('compta.champ.montant_signe'));" "" \
  "$BQ1"
prouver "une ligne d'un autre compte rapprochée" $M23 \
  "      if v_compte <> r.compte then" "      if false then" \
  "$BQ2"
prouver "une ligne d'écriture qui répond de deux lignes de relevé" $M23 \
  "      if exists (select 1 from compta.rapprochement where ligne = v_face and releve_ligne <> v_ligne) then" "      if false then" \
  "$BQ2"
prouver "un rapprochement qui retient un brouillard changé" $M23 \
  "  ligne uuid not null unique references compta.ligne(id) on delete cascade," "  ligne uuid not null unique references compta.ligne(id)," \
  "$BQ2"
prouver "un jugement « certain » sans écriture en face" $M23 \
  "      if v_niveau not in ('aucun', 'probable', 'a-confirmer') then perform socle.refus('un jugement" "      if false then perform socle.refus('un jugement" \
  "$BQ2"
prouver "le jugement de l'automatique perdu" $M23 \
  "      update compta.releve_ligne set niveau = v_niveau where id = v_ligne;" "      update compta.releve_ligne set niveau = 'aucun' where id = v_ligne;" \
  "$BQ2"
prouver "« tout défaire » qui ne défait rien" $M23 \
  "where a.releve_ligne = l.id and l.releve = p_releve;" "where false;" \
  "$BQ2"
prouver "rapprocher sans saisir, dans la base" $M23 \
  "declare v_n int;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');" "declare v_n int;
begin
  perform compta.exiger(p_entreprise, 'compta.livres.voir');" \
  "$BQ2"
prouver "le rang de la ligne en face perdu" $BQS \
  "rang: Number(l.rang_face)," "rang: 1," \
  "$BQ2"
prouver "des réglages du cabinet qui prennent un champ de plus" $CRT \
  "  }).strict()).max(30),
}).partial().strict();" "  }).strict()).max(30),
}).partial();" \
  "$BQ3"
prouver "des réglages du cabinet écrasés" $CRT \
  "      if (connue !== corps.revision) return { statut: 409, corps: { motif: motif('cabinet.reglages_changes'), revision: connue } };" "" \
  "$BQ3"
prouver "les réglages d'un autre cabinet écrits" $CRT \
  "      if (!membre) return introuvable;" "" \
  "$BQ3"
prouver "les réglages d'un autre cabinet lus" $M23 \
  "create policy visible on cabinet.reglages using (cabinet in (select socle.mes_organisations()));" "create policy visible on cabinet.reglages using (true);" \
  "$BQ3"
prouver "la fiche qui prend n'importe quoi sous « banque »" $CRT \
  "jours: z.number().int().min(0).max(30).nullable() }).partial().strict()," "jours: z.number().int().min(0).max(30).nullable() }).partial()," \
  "$BQ3"
prouver "l'automatique qui ne pose rien au serveur" $PC \
  "        await appel('POST', \`/entreprises/\${o.dossierId}/compta/releves/\${o.releveId}/rapprochements\`, { poses: poses.slice(i, i + 5000) });" "        void poses;" \
  "$WB1"
prouver "l'association des colonnes d'une banque oubliée" $PC \
  "        if (o.banques && typeof o.banques === 'object') contenu.banques = o.banques;" "" \
  "$WB1"
prouver "le mot retenu oublié" $PC \
  "        if (Array.isArray(o.libelles)) contenu.libelles = o.libelles;" "" \
  "$WB1"
prouver "le compte bancaire du dossier oublié" $PC \
  "    if (bq && typeof bq === 'object') {" "    if (false) {" \
  "$WB1"
prouver "un rapprochement vers la mauvaise ligne de l'écriture" $PC \
  "    const l = e && e.lignes[Number(i)];" "    const l = e && e.lignes[0];" \
  "$WB1"
prouver "les relevés que le livre ne lit pas" $PC \
  "    livre.releves = releves;" "" \
  "$WB1"

# ── Brique 41 : la déclaration du mois (docs/cabinet.md, C22 à C24) ──
M24=base/migrations/0024_compta_declaration.sql
DCS=serveur/compta/declaration.ts
DC1="une période a une déclaration : ses cases au millime, refaite tant qu'elle n'est pas déposée ; on ne paie pas ce qu'on n'a pas déposé ; une voisine n'en lit rien"
DC2="qui peut : le propriétaire, l'associé, le collaborateur si le mandat comprend les déclarations ; jamais l'assistant ; la porte et la base"
DC3="l'écriture du mois : au brouillard, datée dans le mois, liée ; la repasser se refuse ; un complément ne remplace pas le lien ; supprimée ou contre-passée, le lien tombe"
WD1="préparer, écrire, recalculer après une vente oubliée, compléter, déposer, payer, dé-pointer ; la forme copiée se retient"
prouver "une case de déclaration inventée" $M24 \
  "    if not (k = any(compta.cases_declaration())) then" "    if false then" \
  "$DC1"
prouver "une case de déclaration qui n'est pas en millimes" $M24 \
  "    if not (jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'number' and socle.sans_virgule(v))) then" "    if false then" \
  "$DC1"
prouver "une déclaration déposée refaite" $M24 \
  "  if d.deposee_le is not null then" "  if false then" \
  "$DC1"
prouver "une déclaration refaite qui s'ajoute" $M24 \
  "  if d.id is not null then
    update compta.declaration set cases" "  if false then
    update compta.declaration set cases" \
  "$DC1"
prouver "payée sans être déposée" $M24 \
  "  if p_quoi = 'payee' and p_le is not null and d.deposee_le is null then" "  if false then" \
  "$DC1"
prouver "le paiement qui tombe avec le dépôt, sans le dire" $M24 \
  "    v_aussi := p_le is null and d.payee_le is not null;" "    v_aussi := false;" \
  "$DC1"
prouver "les déclarations d'une voisine lues" $M24 \
  "create policy visible on compta.declaration using (entreprise in (select compta.mes_entreprises()));" "create policy visible on compta.declaration using (true);" \
  "$DC1"
prouver "une période illisible envoyée à la base" $DCS \
  "      if (!estPeriode(params.periode)) return champInvalide('periode', t('compta.champ.periode'));
      const cases" "      const cases" \
  "$DC1"
prouver "les cases lues en millimes bruts" $DCS \
  "v === null ? null : versTexte(BigInt(v), 3)" "v === null ? null : String(v)" \
  "$DC1"
prouver "une forme de montant copié inventée" $CRT \
  "  formatCopie: z.enum(['point', 'virgule', 'millimes'])," "  formatCopie: z.string()," \
  "$DC1"
prouver "l'assistant qui prépare, dans la base" $M24 \
  "socle.mes_roles(p_entreprise) && array['supervision', 'revision']::text[]
    when socle.ma_cle()" "socle.mes_roles(p_entreprise) && array['supervision', 'revision', 'saisie']::text[]
    when socle.ma_cle()" \
  "$DC2"
prouver "un cabinet sans le périmètre des déclarations qui déclare, dans la base" $M24 \
  "      'declarations' = any(socle.perimetre_cabinet(p_entreprise)) and socle.mes_roles" "      socle.mes_roles" \
  "$DC2"
prouver "préparer sans le garde, dans la base" $M24 \
  "declare d compta.declaration; v_id uuid; k text; v jsonb;
begin
  perform compta.exiger_declarer(p_entreprise);" "declare d compta.declaration; v_id uuid; k text; v jsonb;
begin" \
  "$DC2"
prouver "pointer sans le garde, dans la base" $M24 \
  "declare d compta.declaration; v_aussi boolean := false;
begin
  perform compta.exiger_declarer(p_entreprise);" "declare d compta.declaration; v_aussi boolean := false;
begin" \
  "$DC2"
prouver "la porte qui oublie le périmètre des déclarations" serveur/compta/gestes.ts \
  "  { code: 'compta.declarations.preparer', module: 'compta', ecrit: true, perimetre: ['declarations']," "  { code: 'compta.declarations.preparer', module: 'compta', ecrit: true," \
  "$DC2"
prouver "la porte qui lit le périmètre du module, jamais celui du geste" serveur/porte/porte.ts \
  "    const ouvrent = geste.perimetre ?? PERIMETRE_DU_MODULE[geste.module] ?? [];" "    const ouvrent = PERIMETRE_DU_MODULE[geste.module] ?? [];" \
  "$DC2"
prouver "la porte qui laisse l'assistant préparer" serveur/compta/gestes.ts \
  "    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui', revision: 'oui' } },
  // Préparer la liasse" "    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui', revision: 'oui', saisie: 'oui' } },
  // Préparer la liasse" \
  "$DC2"
prouver "écrire l'écriture d'une déclaration sans le garde, dans la base" $M24 \
  "declare d compta.declaration; v_id uuid;
begin
  perform compta.exiger_declarer(p_entreprise);" "declare d compta.declaration; v_id uuid;
begin" \
  "$DC3"
prouver "l'écriture d'une déclaration jamais préparée" $M24 \
  "  if not found then perform socle.refus('prépare la déclaration avant d''en écrire l''écriture'); end if;" "" \
  "$DC3"
prouver "l'écriture d'une déclaration datée hors du mois" $M24 \
  "  if coalesce(p_ecriture->>'date', '') not like p_periode || '-%' then" "  if false then" \
  "$DC3"
prouver "l'écriture du mois passée deux fois" $M24 \
  "  if not coalesce(p_complement, false) and compta.ecriture_vivante(d.ecriture) then" "  if false then" \
  "$DC3"
prouver "un complément qui prend le lien de l'écriture du mois" $M24 \
  "  if not coalesce(p_complement, false) then update compta.declaration set ecriture = v_id" "  if true then update compta.declaration set ecriture = v_id" \
  "$DC3"
prouver "une écriture contre-passée qui reste liée" $M24 \
  "     and not exists (select 1 from compta.ecriture c where c.origine_type = 'contre_passation' and c.origine = p_id)" "" \
  "$DC3"
prouver "le lien lu sans savoir s'il vaut encore" $DCS \
  "          case when compta.ecriture_vivante(d.ecriture) then d.ecriture end ecriture" "          d.ecriture ecriture" \
  "$DC3"
prouver "les déclarations que le livre ne lit pas" $PC \
  "    livre.declarations = declarations;" "" \
  "$WD1"
prouver "les cases préparées envoyées vides" $PC \
  "        if (c) cases[k] = c.montant == null ? null : signe(c.montant);" "        if (c) cases[k] = null;" \
  "$WD1"
prouver "un dépôt pointé sur des chiffres qui ont changé" $PC \
  "      const essai = KC.pointerDeclaration(livre, o.periode, o.quoi, o.valeur, '', Date.now());
      if (!essai.ok) throw new Error(essai.motif);" "      void KC;" \
  "$WD1"
prouver "un complément envoyé comme une seconde écriture du mois" $PC \
  "        const r = await appel('POST', url, { ecriture: versLeServeur(complement), complement: true });" "        const r = await appel('POST', url, { ecriture: versLeServeur(complement), complement: false });" \
  "$WD1"
prouver "la forme copiée oubliée au rechargement" $PC \
  "if (c[k] !== undefined && c[k] !== null) settings[k] = c[k];" "if (c[k] !== undefined && c[k] !== null && k !== 'formatCopie') settings[k] = c[k];" \
  "$WD1"
prouver "un réglage que le serveur ne garde pas « enregistré » sans l'être" $PC \
  "      if (Object.keys(p).some((k) => !REGLAGES_V10.includes(k))) throw new Error(PAS_EN_LIGNE);" "" \
  "$WD1"

# ── Brique 41 bis : la page Écritures (docs/cabinet.md, C25) ──
WE1="les mois qui ont des écritures, le mois à valider et le client sans écriture nommés ; le fichier regroupe les livres du serveur, rien d'autre"
CCC=web/public/v10/cabinet/cabcore.js
prouver "un mois qui déborde dans un autre" $PC \
  "(livres.get(p.id) || []).filter((e) => String(e.date).startsWith(p.month))" "(livres.get(p.id) || []).filter(() => true)" \
  "$WE1"
prouver "le numéro d'export qui n'est pas celui du livre-journal" $PC \
  "          e.chaine ?? '', K.csvDate(e.date), e.journal," "          e.numero || '', K.csvDate(e.date), e.journal," \
  "$WE1"
prouver "un brouillard exporté comme validé" $PC \
  "(e.statut !== 'validee' ? 'brouillard' : e.contrepassee" "(false ? 'brouillard' : e.contrepassee" \
  "$WE1"
prouver "le plan qui attend encore un fichier reçu" $CCC \
  "      const dans = (d.packs || []).filter(p => (!du || (p.month >= du && p.month <= au)))" "      const dans = (d.packs || []).filter(p => p.path && (!du || (p.month >= du && p.month <= au)))" \
  "$WE1"
prouver "un client hors SkanFact sans écriture tu" $CCC \
  "      if (!dans.length) { if (!d.archived && !d.demo) sansPaquet.push(d.name); return; }" "      if (!dans.length) { if (!d.manual && !d.archived && !d.demo) sansPaquet.push(d.name); return; }" \
  "$WE1"
prouver "les mois proposés qui attendent un fichier reçu" web/public/v10/cabinet/app.js \
  "(S.dossiers || []).forEach(d => (d.packs || []).forEach(p => { s.add(p.month); }));" "(S.dossiers || []).forEach(d => (d.packs || []).forEach(p => { if (p.path) s.add(p.month); }));" \
  "$WE1"
prouver "la visite de l'export encore absente" $PC \
  "  const VISITES_PAS_ENCORE = [
" "  const VISITES_PAS_ENCORE = [
    'exporter-ecritures',
" \
  "$WE1"

# ── Brique 41 ter : la liasse et l'annuel (docs/cabinet.md, C26 et C27) ──
M25=base/migrations/0025_compta_annuel.sql
M34=base/migrations/0034_compta_liasse_close.sql
ANS=serveur/compta/annuel.ts
AN1="retraitements et taux : posés et relus au millime ; ce qui n'est pas envoyé ne change pas ; ce qui ne se lit pas se refuse ; changés ailleurs, jamais écrasés ; une voisine n'en lit rien"
AN2="qui peut : le propriétaire et l'associé ; ni le collaborateur ni l'assistant ; la porte et la base"
AN3="le modèle de liasse du cabinet : ses rubriques, rien d'autre"
WL1="le résultat des livres du serveur ; le taux et un retraitement font le résultat fiscal et l'impôt ; le modèle de rubriques s'écrit"
prouver "un retraitement de nature inconnue" $M34 \
  "    if coalesce(r->>'nature', '') not in ('reintegration', 'deduction', 'deficit', 'amortissement') then" "    if false then" \
  "$AN1"
prouver "un retraitement sans libellé" $M34 \
  "    if length(trim(coalesce(r->>'libelle', ''))) = 0 or length(r->>'libelle') > 200 then" "    if false then" \
  "$AN1"
prouver "un retraitement nul, à virgule ou en texte" $M34 \
  "    if jsonb_typeof(r->'montant') <> 'number' or not socle.sans_virgule(r->'montant') or (r->>'montant')::numeric <= 0 then" "    if false then" \
  "$AN1"
prouver "un taux d'impôt hors de 0 à 100" $M34 \
  "  if p_taux is not null and (p_taux < 0 or p_taux > 1000000) then perform socle.refus(" "  if false then perform socle.refus(" \
  "$AN1"
prouver "une liasse changée ailleurs, écrasée" $M34 \
  "  if coalesce(a.revision, 0) <> coalesce(p_revision, 0) then" "  if false then" \
  "$AN1"
prouver "la liasse d'une voisine lue" $M25 \
  "create policy visible on compta.annuel using (entreprise in (select compta.mes_entreprises()));" "create policy visible on compta.annuel using (true);" \
  "$AN1"
prouver "le taux seul qui efface les retraitements" $ANS \
  "      let retraitements = avant?.retraitements ?? [];" "      let retraitements = [];" \
  "$AN1"
prouver "un taux lu à la mauvaise échelle" $ANS \
  "try { taux = depuisTexte(brut, 4).toString(); }" "try { taux = depuisTexte(brut, 3).toString(); }" \
  "$AN1"
prouver "un taux relu avec ses zéros" $ANS \
  "versTexte(BigInt(v), 4).replace(/\\.?0+\$/, '')" "versTexte(BigInt(v), 4)" \
  "$AN1"
prouver "un retraitement relu en millimes bruts" $ANS \
  "montant: versTexte(BigInt(r.montant), 3) }))," "montant: String(r.montant) }))," \
  "$AN1"
prouver "le collaborateur qui prépare la liasse, dans la base" $M25 \
  "'comptabilite' = any(socle.perimetre_cabinet(p_entreprise)) and 'supervision' = any(socle.mes_roles(p_entreprise))" "'comptabilite' = any(socle.perimetre_cabinet(p_entreprise)) and socle.mes_roles(p_entreprise) && array['supervision', 'revision']::text[]" \
  "$AN2"
prouver "poser la liasse sans le garde, dans la base" $M34 \
  "  if not compta.peut_liasse(p_entreprise) then perform socle.refus('ton rôle ne permet pas de préparer la liasse de ce dossier'); end if;" "" \
  "$AN2"
prouver "la porte qui laisse le collaborateur préparer la liasse" serveur/compta/gestes.ts \
  "    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui' } },
  // Les questions" "    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui', revision: 'oui' } },
  // Les questions" \
  "$AN2"
prouver "une rubrique de liasse sur un état inventé" $CRT \
  "id: z.string().min(1).max(20), etat: z.enum(['bilan-actif', 'bilan-passif', 'resultat']), label:" "id: z.string().min(1).max(20), etat: z.string(), label:" \
  "$AN3"
prouver "une rubrique de liasse sur un compte qui n'en est pas un" $CRT \
  "comptes: z.array(z.string().regex(/^\\d{1,12}\$/)).max(100)," "comptes: z.array(z.string()).max(100)," \
  "$AN3"
prouver "une rubrique de liasse qui prend un champ de plus" $CRT \
  "    deduit: z.boolean(), charge: z.boolean(), resultat: z.boolean(), deuxSens: z.boolean(),
  }).strict()).max(300)," "    deduit: z.boolean(), charge: z.boolean(), resultat: z.boolean(), deuxSens: z.boolean(),
  })).max(300)," \
  "$AN3"
prouver "le taux gardé qui tombe quand on ajoute un retraitement" $ANS \
  "      let taux = avant?.taux_impot ?? null;" "      let taux = null;" \
  "$WL1"
prouver "l'impôt calculé sans le taux du serveur" $PC \
  "fiscal: KC.resultatFiscal(liasse.resultat, annuel.retraitements, { taux: annuel.tauxImpot })," "fiscal: KC.resultatFiscal(liasse.resultat, annuel.retraitements, { taux: null })," \
  "$WL1"
prouver "le taux saisi jamais envoyé" $PC \
  "      if (o.tauxImpot !== undefined) {" "      if (false) {" \
  "$WL1"
prouver "le modèle de liasse du cabinet ignoré" $PC \
  "      const modele = (reglages.contenu.liasse || []).length ? KC.migrerModeleLiasse(reglages.contenu.liasse) : KC.MODELE_LIASSE;" "      const modele = KC.MODELE_LIASSE;" \
  "$WL1"
prouver "le modèle de liasse jamais enregistré" $PC \
  "        const contenu = { ...reglages.contenu, liasse };" "        const contenu = { ...reglages.contenu };" \
  "$WL1"

# ── Brique 42 : les immobilisations (docs/cabinet.md, C28 et C29) ──
M26=base/migrations/0026_compta_immobilisations.sql
IMS=serveur/compta/immobilisations.ts
IM1="une fiche : posée et relue au millime ; ce qui ne tient pas se refuse ; changée ailleurs, jamais écrasée ; une voisine n'en lit rien"
IM2="les dotations : au brouillard, liées ; repassées, refusées ; écrite, le plan ne change pas et la fiche ne se supprime pas ; supprimée ou contre-passée, le lien tombe"
IM3="qui peut : qui saisit pose une fiche, qui valide écrit les dotations ; la base aussi"
WI1="l'acquisition se propose, la fiche se crée, la dotation s'écrit au millime et se lie ; écrite, le plan ne change plus"
prouver "un bien sans libellé" $M26 \
  "  if length(trim(coalesce(p_fiche->>'libelle', ''))) = 0 then perform socle.refus('le bien" "  if false then perform socle.refus('le bien" \
  "$IM1"
prouver "un bien sans valeur" $M26 \
  "  if jsonb_typeof(p_fiche->'valeur') <> 'number' or (p_fiche->>'valeur')::numeric <= 0 then" "  if false then" \
  "$IM1"
prouver "une valeur résiduelle qui atteint la valeur" $M26 \
  "  if (p_fiche->>'residuelle')::numeric >= (p_fiche->>'valeur')::numeric then" "  if false then" \
  "$IM1"
prouver "une durée nulle" $M26 \
  "  if jsonb_typeof(p_fiche->'dureeCentiemes') <> 'number' or (p_fiche->>'dureeCentiemes')::numeric <= 0 then" "  if false then" \
  "$IM1"
prouver "un dégressif sans taux" $M26 \
  "  if p_fiche->>'methode' = 'degressif' and coalesce((p_fiche->>'tauxDegressif')::numeric, 0) <= 0 then" "  if false then" \
  "$IM1"
prouver "un bien cédé avant sa mise en service" $M26 \
  "  if jsonb_typeof(p_fiche->'cession') = 'object' and coalesce(p_fiche->'cession'->>'date', '') < v_mes then" "  if false then" \
  "$IM1"
prouver "une fiche changée ailleurs, écrasée" $M26 \
  "  if x.revision <> coalesce(p_revision, 0) then
    raise exception 'cette fiche a été changée ailleurs entre-temps : recharge-la, rien n''a été enregistré' using errcode = 'SK409';
  end if;
  v_ecrite := compta.annee_ecrite(x.id);
  if v_ecrite is not null then
    foreach" "  if false then
    raise exception 'cette fiche a été changée ailleurs entre-temps : recharge-la, rien n''a été enregistré' using errcode = 'SK409';
  end if;
  v_ecrite := compta.annee_ecrite(x.id);
  if v_ecrite is not null then
    foreach" \
  "$IM1"
prouver "les biens d'une voisine lus" $M26 \
  "create policy visible on compta.immobilisation using (entreprise in (select compta.mes_entreprises()));" "create policy visible on compta.immobilisation using (true);" \
  "$IM1"
prouver "un montant de bien lu à la mauvaise échelle" $IMS \
  "const argent = (v: string, champ: string) => exact(v, 3) ?? champ;" "const argent = (v: string, champ: string) => exact(v, 2) ?? champ;" \
  "$IM1"
prouver "une durée en années entières seulement" $IMS \
  "  const duree = exact(f.duree, 2);" "  const duree = exact(f.duree, 0);" \
  "$IM1"
prouver "une durée relue avec ses zéros" $IMS \
  "    duree: versTexte(BigInt(dureeCentiemes), 2).replace(/\\.?0+\$/, '')," "    duree: versTexte(BigInt(dureeCentiemes), 2)," \
  "$IM1"
prouver "le plan changé sous une dotation écrite" $M26 \
  "      if (x.fiche->k) is distinct from (p_fiche->k) then" "      if false then" \
  "$IM2"
prouver "une sortie posée sous une dotation écrite" $M26 \
  "    if (x.fiche->'cession') is distinct from (p_fiche->'cession') then" "    if false then" \
  "$IM2"
prouver "une fiche supprimée sous sa dotation" $M26 \
  "  if v_ecrite is not null then
    perform socle.refus(format('la dotation de %s est passée en écriture : supprimer" "  if false then
    perform socle.refus(format('la dotation de %s est passée en écriture : supprimer" \
  "$IM2"
prouver "une dotation passée deux fois" $M26 \
  "    if v_genre <> 'subvention' and exists (select 1 from compta.immobilisation_ecriture l where l.immobilisation = x.id and l.annee = p_annee" "    if false and exists (select 1 from compta.immobilisation_ecriture l where l.immobilisation = x.id and l.annee = p_annee" \
  "$IM2"
prouver "une dotation datée hors de son année" $M26 \
  "    if coalesce(p->'ecriture'->>'date', '') not like p_annee || '-%' then" "    if false then" \
  "$IM2"
prouver "une dotation écrite sans lien vers son bien" $M26 \
  "      insert into compta.immobilisation_ecriture (immobilisation, annee, genre, ecriture, entreprise) values (x.id, p_annee, v_genre, v_id, p_entreprise)
      on conflict (immobilisation, annee, genre) do update set ecriture = excluded.ecriture;" "      null;" \
  "$IM2"
prouver "le lien d'une dotation contre-passée lu comme s'il valait" $IMS \
  "where l.entreprise = \$1 and compta.ecriture_vivante(l.ecriture) order by" "where l.entreprise = \$1 order by" \
  "$IM2"
prouver "une dotation contre-passée qui bloque encore sa fiche" $M26 \
  "  select min(l.annee) from compta.immobilisation_ecriture l where l.immobilisation = p_immobilisation and compta.ecriture_vivante(l.ecriture)" "  select min(l.annee) from compta.immobilisation_ecriture l where l.immobilisation = p_immobilisation" \
  "$IM2"
prouver "les dotations écrites par qui ne valide pas, dans la base" $M26 \
  "  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  if p_pieces is null" "  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');
  if p_pieces is null" \
  "$IM3"
prouver "les biens que le livre ne lit pas" $PC \
  "    livre.immobilisations = biens.map((/** @type {any} */ b) => (String(b.dateMiseEnService" "    livre.immobilisations = [].map((/** @type {any} */ b) => (String(b.dateMiseEnService" \
  "$WI1"
prouver "les dotations écrites oubliées du plan" $PC \
  "        plan: (x.ecritures || []).map((/** @type {any} */ l) => ({ annee: l.annee, ecritureId: l.ecriture }))," "        plan: []," \
  "$WI1"
prouver "le refus de la v10 sauté avant d'enregistrer un bien" $PC \
  "      if (!r.ok) throw new Error(r.motif);
      const corps = { fiche: ficheVersLeServeur(r.fiche) };" "      const corps = { fiche: ficheVersLeServeur(r.fiche) };" \
  "$WI1"
prouver "l'acquisition d'où vient un bien oubliée" $PC \
  "docId: String((f.origine || {}).docId || '').slice(0, 100)," "docId: ''," \
  "$WI1"

# ── Brique 42 bis : l'inventaire de stock (docs/cabinet.md, C30) ──
M27=base/migrations/0027_compta_inventaire.sql
INS=serveur/compta/inventaire.ts
IV1="un inventaire : posé, son total calculé au serveur au millime ; ce qui ne tient pas se refuse ; une voisine n'en lit rien"
IV2="la variation : au brouillard, liée ; repassée, refusée ; l'inventaire ne se refait pas sous elle ; supprimée ou contre-passée, le lien tombe"
WV1="l'inventaire collé s'enregistre au millime ; la variation s'écrit au brouillard, liée ; dessous, l'inventaire ne se refait pas"
prouver "un inventaire daté dans une autre année" $M27 \
  "  if extract(year from v_date) <> p_annee then perform socle.refus(" "  if false then perform socle.refus(" \
  "$IV1"
prouver "un inventaire sans ligne" $M27 \
  "  if jsonb_typeof(p_inventaire->'lignes') <> 'array' or jsonb_array_length(p_inventaire->'lignes') = 0 then" "  if false then" \
  "$IV1"
prouver "une ligne d'inventaire sans désignation" $M27 \
  "    if length(trim(coalesce(l->>'libelle', ''))) = 0 then perform socle.refus(format('ligne %s : la désignation manque', k)); end if;" "" \
  "$IV1"
prouver "une quantité négative ou à virgule inventoriée" $M27 \
  "    if jsonb_typeof(l->'quantite') <> 'number' or not socle.sans_virgule(l->'quantite') or (l->>'quantite')::numeric < 0 then" "    if false then" \
  "$IV1"
prouver "un coût unitaire négatif inventorié" $M27 \
  "    if jsonb_typeof(l->'cout') <> 'number' or not socle.sans_virgule(l->'cout') or (l->>'cout')::numeric < 0 then" "    if false then" \
  "$IV1"
prouver "un inventaire sans compte de stock" $M27 \
  "  if coalesce(p_inventaire->>'compte', '') !~ '^[0-9]{1,12}\$' then perform socle.refus(" "  if false then perform socle.refus(" \
  "$IV1"
prouver "la valeur d'une ligne tronquée au lieu d'arrondie" $M27 \
  "    v_total := v_total + round((l->>'quantite')::numeric * (l->>'cout')::numeric / 1000)::bigint;" "    v_total := v_total + trunc((l->>'quantite')::numeric * (l->>'cout')::numeric / 1000)::bigint;" \
  "$IV1"
prouver "l'inventaire d'une voisine lu" $M27 \
  "create policy visible on compta.inventaire using (entreprise in (select compta.mes_entreprises()));" "create policy visible on compta.inventaire using (true);" \
  "$IV1"
prouver "une quantité lue en entiers seulement" $INS \
  "try { quantite = depuisTexte(l.quantite, 3); }" "try { quantite = depuisTexte(l.quantite, 0); }" \
  "$IV1"
prouver "un inventaire refait sous sa variation" $M27 \
  "  if found and compta.ecriture_vivante(x.ecriture) then" "  if false then" \
  "$IV2"
prouver "une variation de stock passée deux fois" $M27 \
  "  if compta.ecriture_vivante(x.ecriture) then
    perform socle.refus('la variation de stock de cet exercice est déjà passée" "  if false then
    perform socle.refus('la variation de stock de cet exercice est déjà passée" \
  "$IV2"
prouver "une variation datée hors de son année" $M27 \
  "  if coalesce(p_ecriture->>'date', '') not like p_annee || '-%' then" "  if false then" \
  "$IV2"
prouver "une variation écrite sans lien vers son inventaire" $M27 \
  "  update compta.inventaire set ecriture = v_id where entreprise = p_entreprise and annee = p_annee;" "" \
  "$IV2"
prouver "une variation écrite par qui ne valide pas, dans la base" $M27 \
  "  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  select * into x from compta.inventaire" "  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');
  select * into x from compta.inventaire" \
  "$IV2"
prouver "le lien d'une variation contre-passée lu comme s'il valait" $INS \
  "case when compta.ecriture_vivante(ecriture) then ecriture end ecriture from compta.inventaire" "ecriture from compta.inventaire" \
  "$IV2"
prouver "l'inventaire que le livre ne lit pas" $PC \
  "    livre.inventaires = inventaire ? [inventaire] : [];" "" \
  "$WV1"
prouver "le total du serveur ignoré" $PC \
  "      id: \`inv_\${x.annee}\`, date: x.date, compte: x.compte, total: nombre(x.total)," "      id: \`inv_\${x.annee}\`, date: x.date, compte: x.compte, total: 0," \
  "$WV1"
prouver "le refus de la v10 sauté avant de refaire l'inventaire" $PC \
  "      const r = KC.poserInventaire(livre, o.inventaire, '', Date.now());
      if (!r.ok) throw new Error(r.motif);" "      const r = KC.poserInventaire({ ...livre, inventaires: [] }, o.inventaire, '', Date.now());" \
  "$WV1"

# ── Brique 43 : la paie tenue par le cabinet (docs/cabinet.md, C31) ──
PA1="avec le mandat de la paie, l'associé tient les salariés et les bulletins du client : recalculés au serveur, écrits au livre ; sans lui, rien"
PA2="qui peut : l'associé et le collaborateur Paie, le propriétaire ; pas le collaborateur comptable"
WP1="un salarié et son bulletin, écrits dans le dossier du client ; le serveur les tient au millime et écrit le mois"
prouver "le cabinet qui écrit autre chose que la paie du dossier" serveur/paie/routes.ts \
  "collection: z.enum(['employees', 'payslips'], { message: 'paie.champ.collection' }), cle:" "collection: z.string(), cle:" \
  "$PA1"
prouver "la paie ouverte au cabinet sans le mandat de la paie" serveur/paie/gestes.ts \
  "  { code: 'paie.dossier.modifier', module: 'paie', ecrit: true, horsCle: true," "  { code: 'paie.dossier.modifier', module: 'paie', ecrit: true, horsCle: true, perimetre: ['comptabilite']," \
  "$PA1"
prouver "la paie ouverte, dans la base, au collaborateur comptable" base/migrations/0019_cabinet.sql \
  "      or (socle.mes_roles(e) && array['supervision', 'paie']::text[] and 'paie' = any(coalesce(socle.perimetre_cabinet(e), '{}')))" "      or (socle.mes_roles(e) && array['supervision', 'paie', 'revision']::text[] and 'paie' = any(coalesce(socle.perimetre_cabinet(e), '{}')))" \
  "$PA2"
prouver "les salariés que la paie du Cabinet ne lit pas" $PC \
  "    livre.salaries = objets.filter((/** @type {any} */ o) => o.collection === 'employees').map((/** @type {any} */ o) => salarieDe(o.contenu));" "    livre.salaries = [];" \
  "$WP1"
prouver "le nom du salarié perdu en l'écrivant" $PC \
  "    method: 'virement', iban: '', ...(avant || {}), id: s.id, name: s.nom," "    method: 'virement', iban: '', ...(avant || {}), id: s.id, name: ''," \
  "$WP1"
prouver "un bulletin écrit sans son calcul" $PC \
  "gross: b.brut, workedDays: b.joursTravailles, absentDays: b.joursAbsence, bonuses: b.primes, deductions: b.retenues, computed: b.calcul," "gross: b.brut, workedDays: b.joursTravailles, absentDays: b.joursAbsence, bonuses: b.primes, deductions: b.retenues, computed: {}," \
  "$WP1"
prouver "l'écriture de paie du serveur ignorée" $PC \
  "e.journal === 'PAIE' && String(e.date).slice(0, 7) === mois && e.statut !== 'contrepassee'" "false" \
  "$WP1"

# ── Brique 44 : la révision et les questions au client (docs/cabinet.md, C32 et C33) ──
RV1="se garde entière par période, avec sa révision ; changée ailleurs, jamais écrasée"
RV2="qui révise : l'associé et le collaborateur ; ni l'assistant, ni le client (qui ne la lit pas), ni sans la comptabilité au mandat"
RV3="le questionnaire et les cycles du cabinet sont des réglages du cabinet"
QU1="posée, elle reste au cabinet ; envoyée, le client la lit et y répond ; chaque envoi se compte"
QU2="seul le cabinet pose ; une question sans texte, ou qui attend on ne sait quoi, se refuse — à la porte et dans la base"
WR1="la révision se tient à la souris et se garde au serveur ; une question part au client à l'envoi, et sa réponse revient"
M28=base/migrations/0028_revision_questions.sql
prouver "une révision écrasée par un poste qui ne l'avait pas relue" $M28 \
  "  if coalesce(x.revision, 0) <> coalesce(p_revision, 0) then" "  if false then" \
  "$RV1"
prouver "une révision qui prend n'importe quelle forme" serveur/cabinet/routes.ts \
  "corps: z.object({ contenu: REVISION, revision: z.number().int().positive().nullable() }).strict()," "corps: z.object({ contenu: z.record(z.string(), z.unknown()), revision: z.number().int().positive().nullable() }).strict()," \
  "$RV1"
prouver "l'assistant qui révise" $M28 \
  "     and socle.mes_roles(p_entreprise) && array['supervision', 'revision']::text[]" "     and socle.mes_roles(p_entreprise) && array['supervision', 'revision', 'saisie']::text[]" \
  "$RV2"
prouver "la révision sans la comptabilité au mandat" $M28 \
  "and (d.fin is null or d.fin >= current_date) and 'comptabilite' = any(d.perimetre))" "and (d.fin is null or d.fin >= current_date))" \
  "$RV2"
prouver "des cycles aux préfixes qui ne sont pas des comptes" serveur/cabinet/routes.ts \
  "prefixes: z.array(z.string().regex(/^\d{1,12}$/)).min(1).max(50)" "prefixes: z.array(z.string()).min(1).max(50)" \
  "$RV3"
prouver "une question jamais envoyée que le client lit" $M28 \
  "  and (cardinality(envois) > 0 or cabinet is null or cabinet in (select socle.mes_organisations())));" "  and true);" \
  "$QU1"
prouver "une réponse à une question jamais reçue" $M28 \
  "  if not found or cardinality(q.envois) = 0 then perform socle.refus('cette question n''existe plus'); end if;" "  if not found then perform socle.refus('cette question n''existe plus'); end if;" \
  "$QU1"
prouver "une question envoyée qui s'efface" $M28 \
  "  if cardinality(q.envois) > 0 then perform socle.refus('cette question est déjà partie" "  if false then perform socle.refus('cette question est déjà partie" \
  "$QU1"
prouver "un envoi qui ne se compte qu'une fois" $M28 \
  "  update compta.question set envois = envois || now(), statut" "  update compta.question set envois = case when cardinality(envois) = 0 then envois || now() else envois end, statut" \
  "$QU1"
prouver "une question répondue qui se réécrit" $M28 \
  "  if q.statut in ('repondue', 'close') then perform socle.refus('cette question a reçu" "  if q.statut in ('close') then perform socle.refus('cette question a reçu" \
  "$QU1"
prouver "le cabinet qui répond à la place du client, dans la base" $M28 \
  "  if socle.perimetre_cabinet(p_entreprise) is not null or socle.ma_cle() is not null|||     or not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'comptabilite_interne']::text[]) then" "  if socle.ma_cle() is not null|||     then" \
  "$QU1"
prouver "une question à relancer dès le premier envoi" serveur/compta/questions.ts \
  "cardinality(q.envois) >= 2) a_relancer" "cardinality(q.envois) >= 1) a_relancer" \
  "$QU1"
prouver "les questions de toutes les années mêlées" serveur/compta/questions.ts \
  "and (\$2 = '' or left(periode, 4) = \$2)" "and (\$2 = \$2)" \
  "$QU1"
prouver "le client qui pose des questions dans ses propres livres" $M28 \
  "  if v_cabinet is null then perform socle.refus('seul le cabinet" "  if false then perform socle.refus('seul le cabinet" \
  "$QU2"
prouver "la révision réécrite sans sa révision connue" $PC \
  "{ contenu, revision: revisionsRevision.get(cle) ?? null }" "{ contenu, revision: null }" \
  "$WR1"
prouver "les signatures sans nom" $PC \
  "    moiNom = String(moi.nom || '');" "    moiNom = '';" \
  "$WR1"
prouver "la réponse du client qui ne revient pas à l'écran" $PC \
  "reponse: q.reponse ? { texte: q.reponse, le: Date.parse(q.reponduLe) || 0, piece: null } : null," "reponse: null," \
  "$WR1"
prouver "l'envoi qui n'atteint pas le serveur" $PC \
  "/compta/questions/envoyer" "/compta/questions" \
  "$WR1"
prouver "le questionnaire du cabinet qui ne s'enregistre pas" $PC \
  "        contenu.questionnaire = o.modeles.map(" "        contenu.questionnaire_ = o.modeles.map(" \
  "$WR1"
prouver "le dossier de révision qui ne voit pas le questionnaire écrit" web/public/v10/cabinet/app.js \
  ":\${JSON.stringify([S.questionnaire || [], S.cycles || []])}\`;" "\`;" \
  "$WR1"

# ── Brique 44 bis : les questions du cabinet chez le client (docs/cabinet.md, C34) ──
QC1="le client voit les questions envoyées, y répond depuis l'onglet Cabinet et en face de la pièce ; la réponse est au serveur"
PE=web/public/plateforme/pont.js
prouver "les questions du cabinet rangées dans le dossier de l'entreprise" $PE \
  "      const v = champ === 'questionsCabinet' ? [] : brut;" "      const v = brut;" \
  "$QC1"
prouver "une question fermée par le cabinet qui s'affiche chez le client" $PE \
  "    const qs = lues.filter((q) => q.statut !== 'close').map((q) => ({" "    const qs = lues.map((q) => ({" \
  "$QC1"
prouver "la réponse du client qui ne part pas au serveur" $PE \
  "    try { await envoyerReponses(data); } catch (e) {" "    try { void 0; } catch (e) {" \
  "$QC1"
prouver "l'onglet Cabinet qui fabrique encore un paquet" web/public/v10/app.js \
  "      // en direct. L'onglet porte les questions du comptable, et dit à qui le dossier est confié.
      if (bridge.dessinerMandat) {" "      // en direct. L'onglet porte les questions du comptable, et dit à qui le dossier est confié.
      if (false) {" \
  "$QC1"

# ── Brique 45 : la clôture de l'exercice (docs/cabinet.md, C35) ──
CE1="se clôt fini et sans brouillard ; clos, plus rien ne s'y écrit ; rouvert avec un motif, la période revient où elle était"
CE2="rouvert, la période revient à ce qui était validé avant la clôture ; jamais si des jours d'après sont validés"
CE3="qui clôture : l'associé ; ni le collaborateur, ni l'entreprise sous mandat — à la porte et dans la base"
WC1="refusée sur un brouillard, clôturée, les à-nouveaux posés au 1er janvier, rouverte avec son motif"
M29=base/migrations/0029_compta_cloture_exercice.sql
prouver "une clôture qui valide les brouillards en silence" $M29 \
  "  if n > 0 then" "  if false then" \
  "$CE1"
prouver "un exercice clôturé avant d'être fini" $M29 \
  "  if x.au >= aujourdhui then" "  if false then" \
  "$CE1"
prouver "une clôture qui ne ferme pas la période" $M29 \
  "  if c is null or c < x.au then perform compta.valider(p_entreprise, x.au); end if;" "" \
  "$CE1"
prouver "une réouverture sans motif" $M29 \
  "  if length(v_motif) < 5 then" "  if false then" \
  "$CE1"
prouver "le motif d'une réouverture perdu" $M29 \
  "values (p_entreprise, p_annee, x.clos_le, x.clos_par, socle.moi(), v_motif);" "values (p_entreprise, p_annee, x.clos_le, x.clos_par, socle.moi(), 'motif perdu');" \
  "$CE1"
prouver "une réouverture qui rouvre plus que la clôture" $M29 \
  "  if x.jusqua_avant is null then delete from compta.cloture where entreprise = p_entreprise;" "  if true then delete from compta.cloture where entreprise = p_entreprise;" \
  "$CE2"
prouver "une réouverture qui rouvre aussi les jours d'après" $M29 \
  "  if c > x.au then" "  if false then" \
  "$CE2"
prouver "le collaborateur qui clôture, dans la base" $M29 \
  "  if socle.perimetre_cabinet(p_entreprise) is not null and not ('supervision' = any(socle.mes_roles(p_entreprise))) then" "  if false then" \
  "$CE3"
prouver "la porte qui laisse le collaborateur clôturer" serveur/compta/gestes.ts \
  "    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui' } },
];" "    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', supervision: 'oui', revision: 'oui' } },
];" \
  "$CE3"
prouver "l'écran qui ouvre la question de clôture sur un brouillard" web/public/v10/cabinet/app.js \
  "      if (enBrouillard) return toast(enBrouillard.detail, 'error');" "" \
  "$WC1"
prouver "l'exercice clos que l'écran ne voit pas" $PC \
  "      livre.exercice.clos = !!ex.closLe;" "      livre.exercice.clos = false;" \
  "$WC1"
prouver "les à-nouveaux qui ne partent pas au serveur" $PC \
  "      for (const e of essai.ecritures) if (!avant.has(e.id))" "      for (const e of []) if (!avant.has(e.id))" \
  "$WC1"
prouver "l'année d'après qui ne s'ouvre pas" $PC \
  "{ annee, ouverture: [] }" "{ annee: annee + 50, ouverture: [] }" \
  "$WC1"
prouver "les écrans qui ne se relisent pas après une validation" $PC \
  "    livre.audit = new Array(gestesFaits);" "" \
  "$WC1"

# ── Brique 46 : l'équipe du cabinet (docs/cabinet.md, C36) ──
EQ1="l'associé invite par l'adresse ; la personne rejoint avec cette adresse ; on lui confie un dossier ; retirée, elle n'ouvre plus rien"
EQ2="seul un associé invite, change un rôle, retire ; personne ne change son propre rôle ni ne se retire ; une invitation annulée ne vaut plus"
WE1="inviter par l'adresse, rejoindre par le lien, confier un dossier, changer le rôle, retirer"
M30=base/migrations/0030_cabinet_equipe.sql
prouver "une invitation au cabinet acceptée par une autre adresse" $M30 \
  "  if lower(v_email) <> i.email then" "  if false then" \
  "$EQ1"
prouver "une invitation au cabinet qui donne un autre rôle" $M30 \
  "values (socle.moi(), i.organisation, i.roles, i.invite_par)" "values (socle.moi(), i.organisation, array['supervision'], i.invite_par)" \
  "$EQ1"
prouver "un membre retiré qui ouvre encore le cabinet" $M30 \
  "  update socle.membre set actif = false where id = p_membre;" "  update socle.membre set actif = true where id = p_membre;" \
  "$EQ1"
prouver "les invitations acceptées ou annulées qui attendent encore" serveur/cabinet/routes.ts \
  "where organisation = \$1 and acceptee_le is null and annulee_le is null and expire_le > now()" "where organisation = \$1" \
  "$EQ1"
prouver "le cabinet rejoint que l'entrée ne sait pas ouvrir" serveur/routes/socle.ts \
  "cabinet: ou?.organisation ?? null" "cabinet: null" \
  "$EQ1"
prouver "un collaborateur qui invite" $M30 \
  "  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet invite" "  if false then perform socle.refus('seul un associé du cabinet invite" \
  "$EQ2"
prouver "une personne invitée deux fois" $M30 \
  "  if exists (select 1 from socle.membre m join socle.utilisateur u on u.id = m.utilisateur" "  if false and exists (select 1 from socle.membre m join socle.utilisateur u on u.id = m.utilisateur" \
  "$EQ2"
prouver "un associé qui se rétrograde ou se retire" $M30 \
  "  if m.utilisateur = socle.moi() then perform socle.refus('personne ne change" "  if false then perform socle.refus('personne ne change" \
  "$EQ2"
prouver "un collaborateur qui change l'équipe" $M30 \
  "  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet change son équipe'); end if;" "" \
  "$EQ2"
prouver "l'équipe triée selon la langue de la base" serveur/cabinet/routes.ts \
  "and m.actif order by lower(u.nom), u.nom, m.id\`" "and m.actif order by u.nom collate \\"C\\", m.id\`" \
  "$EQ2"
prouver "une invitation annulée qui vaut encore" $M30 \
  "  update socle.invitation set annulee_le = now() where id = p_invitation;" "" \
  "$EQ2"
prouver "l'entrée qui n'ouvre pas le cabinet rejoint" web/src/App.tsx \
  "        if (r.statut === 200 && r.corps.cabinet) { ouvrirCabinet(r.corps.cabinet); return; }" "" \
  "$WE1"
prouver "un dossier confié que le serveur ne reçoit pas" $PC \
  "        if (voulu && voulu !== pose) await appel('PUT'" "        if (false) await appel('PUT'" \
  "$WE1"
prouver "« Saisie et validation » envoyé comme saisie" $PC \
  "validation: 'revision'" "validation: 'saisie'" \
  "$WE1"
prouver "un menu sur sa propre ligne" web/public/v10/cabinet/app.js \
  "\${g.ok && c.id !== equipe.moi ? RowMenu.cellule" "\${g.ok ? RowMenu.cellule" \
  "$WE1"

# ── Brique 47 : la fiche et les réglages du cabinet (docs/cabinet.md, C37) ──
FI1="l'associé renomme le cabinet ; un collaborateur ne le peut pas ; un nom vide est refusé ; le changement se trace"
FI2="l'adresse, le téléphone et les réglages de la v10 se gardent et se relisent ; une valeur hors de sa forme est refusée"
WF1="le nom, l'adresse, le téléphone, les jours, la grille de saisie et le thème s'enregistrent et se relisent"
M31=base/migrations/0031_cabinet_nom.sql
prouver "un collaborateur qui renomme le cabinet" $M31 \
  "  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet change son nom'); end if;" "" \
  "$FI1"
prouver "un nom de cabinet vide" $M31 \
  "  if length(v_nom) = 0 or length(v_nom) > 200 then" "  if length(v_nom) > 200 then" \
  "$FI1"
prouver "un nom changé sans trace" $M31 \
  "  perform socle.tracer(null, 'cabinet.renommer'" "  perform socle.tracer(null, 'cabinet.nommer'" \
  "$FI1"
prouver "le nom gardé tel que tapé, espaces compris" serveur/cabinet/routes.ts \
  "      return { corps: { nom: corps.nom.trim() } };" "      return { corps: { nom: corps.nom } };" \
  "$FI1"
prouver "une adresse du cabinet illisible gardée" serveur/cabinet/routes.ts \
  "  email: z.string().max(200).regex(/^([^\\s@]+@[^\\s@]+\\.[^\\s@]+)?\$/, { message: 'cabinet.champ.email' })," "  email: z.string().max(200)," \
  "$FI2"
prouver "un jour de relance hors du mois" serveur/cabinet/routes.ts \
  "  relanceDay: z.number().int().min(1).max(28)," "  relanceDay: z.number().int().min(1).max(31)," \
  "$FI2"
prouver "un jour d'échéance hors du mois" serveur/cabinet/routes.ts \
  "tvaDay: z.number().int().min(1).max(31)," "tvaDay: z.number().int().min(1).max(99)," \
  "$FI2"
prouver "un thème inventé" serveur/cabinet/routes.ts \
  "  theme: z.enum(['light', 'dark', 'auto'])," "  theme: z.string().max(20)," \
  "$FI2"
prouver "une échéance pointée illisible" serveur/cabinet/routes.ts \
  "  depots: z.array(z.string().regex(/^[a-z-]+@\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])\$/)).max(5000)," "  depots: z.array(z.string().max(40)).max(5000)," \
  "$FI2"
prouver "un régime à la TVA inventée" serveur/cabinet/routes.ts \
  "tva: z.enum(['', 'mensuelle', 'trimestrielle', 'aucune'])," "tva: z.string().max(20)," \
  "$FI2"
prouver "un journal proposé illisible" serveur/cabinet/routes.ts \
  "    journalParDefaut: z.string().regex(/^[A-Z]{0,6}\$/)," "    journalParDefaut: z.string().max(20)," \
  "$FI2"
prouver "le nom du cabinet qui ne part pas au serveur" $PC \
  "      if (nom !== nomDuCabinet) await appel('PUT', \`/cabinets/\${cabinetId}/nom\`, { nom });" "" \
  "$WF1"
prouver "l'adresse du cabinet qui ne part pas au serveur" $PC \
  "      if (c.email !== undefined) contenu.email = String(c.email || '').trim();" "" \
  "$WF1"
prouver "l'adresse du cabinet oubliée au rechargement" $PC \
  "email: String(c.email || '')," "email: ''," \
  "$WF1"
prouver "le thème qui ne part pas au serveur" $PC \
  "        if (p.theme) s.theme = String(p.theme);" "" \
  "$WF1"
prouver "les jours d'échéance qui ne partent pas au serveur" $PC \
  "        if (p.deadlines) s.deadlines = { ...(s.deadlines || {}), ...p.deadlines };" "" \
  "$WF1"
prouver "la grille de saisie qui ne part pas au serveur" $PC \
  "        if (p.saisie) s.saisie =" "        if (false) s.saisie =" \
  "$WF1"
prouver "une adresse illisible envoyée sans un mot sur le champ" web/public/v10/cabinet/app.js \
  "      if (courriel && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+\$/.test(courriel)) {" "      if (false) {" \
  "$WF1"
prouver "un nom vide refusé sans montrer le champ" web/public/v10/cabinet/app.js \
  "      if (!\$('#c-name').value.trim()) return refus('#c-name'," "      if (false) return refus('#c-name'," \
  "$WF1"
prouver "la visite « Nommer mon cabinet » encore cachée" $PC \
  "  const VISITES_PAS_ENCORE = [
" "  const VISITES_PAS_ENCORE = [
    'nommer-cabinet',
" \
  "$WF1"
prouver "la visite qui promet encore un fichier d'appairage" $CVI \
  "      conclusion: 'Il signe désormais tes relances, et tes clients le lisent quand ils te confient leur dossier.'," "      conclusion: 'Il signe désormais tes relances et le fichier d\\'appairage que tes clients importent.'," \
  "$WF1"

# ── Brique 48 : la production du portefeuille (docs/cabinet.md, C38) ──
PR1="compte chaque mois de chaque dossier : écritures, validées, brouillards, dernier geste ; déclarations, révisions, exercices ; rien d'autre"
WP1="les étapes de chaque mois, « à saisir » relu en revenant, la ligne qui ouvre le client, la visite"
CR=serveur/cabinet/routes.ts
prouver "les à-nouveaux comptés comme une saisie" $CR \
  "and e.date_ecriture >= \$2::date and e.journal <> 'AN'
          group by" "and e.date_ecriture >= \$2::date
          group by" \
  "$PR1"
prouver "les brouillards comptés validés" $CR \
  "count(*) filter (where e.statut = 'validee') validees" "count(*) validees" \
  "$PR1"
prouver "le dernier geste d'une saisie sans son auteur" $CR \
  "on u.id = coalesce(e.validee_par, e.saisie_par)" "on u.id = e.validee_par" \
  "$PR1"
prouver "le dernier geste sans la validation" $CR \
  "            max(greatest(e.cree_le, e.validee_le)) depuis" "            max(e.cree_le) depuis" \
  "$PR1"
prouver "une déclaration préparée comptée déposée" $CR \
  "select entreprise, periode, deposee_le is not null deposee from compta.declaration" "select entreprise, periode, true deposee from compta.declaration" \
  "$PR1"
prouver "une révision ouverte comptée arrêtée" $CR \
  "select entreprise, periode, contenu->>'faite' = 'true' faite from cabinet.revision" "select entreprise, periode, true faite from cabinet.revision" \
  "$PR1"
prouver "la révision de l'année comptée comme un mois" $CR \
  "and periode ~ '^[0-9]{4}-[0-9]{2}\$' and periode >= to_char" "and periode >= to_char" \
  "$PR1"
prouver "les mois d'avant la date demandée" $CR \
  "where e.entreprise in (\${portefeuille}) and e.date_ecriture >= \$2::date and e.journal <> 'AN'
          group by" "where e.entreprise in (\${portefeuille}) and e.journal <> 'AN'
          group by" \
  "$PR1"
prouver "les déclarations oubliées par le tableau" $PC \
  "    for (const d of p.declarations || []) mois(d.entreprise, d.periode).declare = !!d.deposee;" "" \
  "$WP1"
prouver "les révisions oubliées par le tableau" $PC \
  "    for (const r of p.revisions || []) mois(r.entreprise, r.periode).revise = !!r.faite;" "" \
  "$WP1"
prouver "le dernier geste sans son nom" $PC \
  "brouillards: m.brouillards, qui: m.qui," "brouillards: m.brouillards, qui: ''," \
  "$WP1"
prouver "l'année d'un dossier tenu qui ne commence pas en janvier" $PC \
  "if (!x.has(a)) x.set(a, { annee: a, du: \`\${a}-01-01\`," "if (!x.has(a)) x.set(a, { annee: a, du: \`\${a}-03-01\`," \
  "$WP1"
prouver "le tableau de production lu une fois pour toutes" web/public/v10/cabinet/app.js \
  "    if (route !== routeLue && route === 'production') prodState.lignes = null;" "" \
  "$WP1"
prouver "le dossier tenu absent des Échéances" $PC \
  "repondues: q.repondues, employeur, tenu: d.manual ? { exercices } : null, declares };" "repondues: q.repondues, employeur, tenu: null, declares };" \
  "$WP1"
prouver "la légende qui parle encore de reçu" web/public/v10/cabinet/app.js \
  "    ['recu', 'manquant'], ['saisi', 'à saisir']," "    ['recu', 'pas encore reçu'], ['saisi', 'à saisir']," \
  "$WP1"
prouver "la visite de la production qui parle encore de paquets" $CVI \
  "      conclusion: 'Le tableau lit les livres : un dossier apparaît dès que sa comptabilité a des écritures," "      conclusion: 'Le tableau lit les livres, pas les paquets : un dossier apparaît dès que sa comptabilité a des écritures," \
  "$WP1"
prouver "la visite de la production encore cachée" $PC \
  "  const VISITES_PAS_ENCORE = [
" "  const VISITES_PAS_ENCORE = [
    'suivre-production',
" \
  "$WP1"

prouver "la bulle de la production qui parle encore de paquets" web/public/v10/cabinet/cabguide.js \
  "Tout est <b>lu</b> — les écritures des livres, les révisions arrêtées" "Tout est <b>lu</b> — les paquets reçus, les révisions arrêtées" \
  "chaque écran du Cabinet, et chaque bulle qu'il porte, se lit sans un mot de paquet"
# ── Brique 49 : le fichier CNSS du trimestre (docs/cabinet.md, C39) ──
WC1="refusé sans matricule employeur, puis téléchargé sous son nom ; son salaire est l'assiette du serveur"
prouver "le fichier CNSS encore absent en ligne" $PC \
  "    fichierCnss: async (" "    fichierCnssAbsent: async (" \
  "$WC1"
prouver "le fichier CNSS sans le matricule de la fiche" $PC \
  "{ matricule: fiche.cnssEmployeur, code: fiche.cnssCode }" "{ matricule: '', code: fiche.cnssCode }" \
  "$WC1"
prouver "le fichier CNSS fabriqué mais jamais téléchargé" $PC \
  "      telecharger(f.nom, f.contenu);
      return { ok: true, path: f.nom," "      return { ok: true, path: f.nom," \
  "$WC1"
prouver "le fichier CNSS téléchargé sans dire de garder son nom" web/public/v10/cabinet/app.js \
  "Il est dans tes téléchargements. Garde-lui exactement ce nom" "Il est dans tes téléchargements. Garde ce fichier" \
  "$WC1"

prouver "une page du fichier CNSS à onze lignes" web/public/v10/compta.js \
  "  const FORMAT_CNSS = { nom: 'CNSS 2012', longueur: 122, lignesParPage: 12 };" "  const FORMAT_CNSS = { nom: 'CNSS 2012', longueur: 122, lignesParPage: 11 };" \
  "exactement 12 lignes par page, pages et lignes consécutives, chaque ligne finie par un retour chariot, en ASCII"
prouver "un salaire du fichier CNSS tronqué au lieu d'arrondi" web/public/v10/compta.js \
  "      const millimes = Math.round((Number(l.salaire) || 0) * 1000);" "      const millimes = Math.floor((Number(l.salaire) || 0) * 1000);" \
  "le salaire en millimes entiers, sans virgule, arrondi au millime"
# ── Brique 50 : les guides d'écritures et le journal retenu (docs/cabinet.md, C40) ──
GU1="un guide se garde dans sa forme et se relit ; une forme fausse est refusée ; le journal retenu se garde dans la fiche"
WG1="créer un guide, s'en servir dans la saisie, retenir le journal, modifier puis supprimer le guide"
prouver "un montant de guide à virgule gardé" serveur/cabinet/routes.ts \
  "      montant: z.string().regex(/^(\\d{1,12}(\\.\\d{1,3})?)?\$/), taux:" "      montant: z.string().max(30), taux:" \
  "$GU1"
prouver "un taux de guide négatif gardé" serveur/cabinet/routes.ts \
  "taux: z.string().regex(/^(\\d{1,4}(\\.\\d{1,6})?)?\$/), base:" "taux: z.string().max(30), base:" \
  "$GU1"
prouver "une ligne de guide sans sens" serveur/cabinet/routes.ts \
  "libelle: texte(200), sens: z.enum(['debit', 'credit'])," "libelle: texte(200), sens: z.string().max(10)," \
  "$GU1"
prouver "un guide d'une seule ligne" serveur/cabinet/routes.ts \
  "    }).strict()).min(2).max(40)," "    }).strict()).min(1).max(40)," \
  "$GU1"
prouver "un journal de guide en minuscules" serveur/cabinet/routes.ts \
  "journal: z.string().regex(/^[A-Z0-9]{1,5}\$/)," "journal: z.string().min(1).max(5)," \
  "$GU1"
prouver "un journal retenu illisible" serveur/cabinet/routes.ts \
  "  dernierJournal: z.string().regex(/^[A-Z0-9]{0,5}\$/)," "  dernierJournal: texte(20)," \
  "$GU1"
prouver "un guide qui ne s'enregistre pas en ligne" $PC \
  "    saveGuides: async (" "    saveGuidesAbsent: async (" \
  "$WG1"
prouver "les guides oubliés au rechargement" $PC \
  "    etat.guides = (reglages.contenu.guides || []).map(" "    etat.guidesOublies = (reglages.contenu.guides || []).map(" \
  "$WG1"
prouver "le taux d'un guide perdu en partant" $PC \
  "montant: decimal(l.montant, 3), taux: decimal(l.taux, 6)," "montant: decimal(l.montant, 3), taux: ''," \
  "$WG1"
prouver "le journal retenu qui ne part pas" $PC \
  "    dernierJournal: async (" "    dernierJournalAbsent: async (" \
  "$WG1"
prouver "le journal retenu oublié par la fiche" $PC \
  "    if (f.dernierJournal != null) contenu.dernierJournal = String(f.dernierJournal).toUpperCase().slice(0, 5);" "" \
  "$WG1"
prouver "une fiche réécrite sur une révision périmée" $PC \
  "    fiches.set(ent, { contenu, revision: r.revision });" "    void r;" \
  "$WG1"

# ── Brique 51 : les abonnements d'un dossier (docs/cabinet.md, C41) ──
AB1="un abonnement se garde dans la fiche du dossier, son montant en texte décimal ; une forme fausse est refusée"
WA1="un abonnement créé, ses mois dus générés au brouillard une seule fois, puis suspendu"
prouver "un montant d'abonnement à virgule gardé" serveur/cabinet/routes.ts \
  "tousLesMois: z.number().int().min(1).max(12), montant: z.string().regex(/^\\d{1,12}(\\.\\d{1,3})?\$/)," "tousLesMois: z.number().int().min(1).max(12), montant: z.string().max(30)," \
  "$AB1"
prouver "un abonnement tous les treize mois" serveur/cabinet/routes.ts \
  "tousLesMois: z.number().int().min(1).max(12)," "tousLesMois: z.number().int().min(1).max(99)," \
  "$AB1"
prouver "un mois fait illisible gardé" serveur/cabinet/routes.ts \
  "  faites: z.array(z.string().regex(/^\\d{4}-(0[1-9]|1[0-2])\$/)).max(600)," "  faites: z.array(z.string().max(10)).max(600)," \
  "$AB1"
prouver "une date de départ illisible gardée" serveur/cabinet/routes.ts \
  "const JOUR_OU_RIEN = z.string().regex(/^(\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01]))?\$/);" "const JOUR_OU_RIEN = z.string().max(20);" \
  "$AB1"
prouver "un abonnement qui ne s'enregistre pas en ligne" $PC \
  "    saveAbonnements: async (" "    saveAbonnementsAbsent: async (" \
  "$WA1"
prouver "un abonnement dont le montant se perd en partant" $PC \
  "montant: (Math.round((Number(a.montant) || 0) * 1000) / 1000).toFixed(3), piece:" "montant: '0.000', piece:" \
  "$WA1"
prouver "deux générations côte à côte qui doublent les mois" $PC \
  "(generation = generation.then(() => genererAbonnements(o), () => genererAbonnements(o)))" "genererAbonnements(o)" \
  "$WA1"
prouver "les mois générés oubliés" $PC \
  "          a.faites.push(date.slice(0, 7));
          notes++;" "          notes++;" \
  "$WA1"
prouver "les mois faits jamais notés dans la fiche" $PC \
  "      if (notes) {" "      if (false) {" \
  "$WA1"
prouver "le menu d'un abonnement qui n'ouvre rien" web/public/v10/cabinet/app.js \
  "    bindRowMenus(box, cle => actionsAbonnement(root, dossier, cle));" "" \
  "$WA1"

# ── Brique 52 : une liste de clients collée (docs/cabinet.md, C42) ──
WL1="une ligne fausse arrête tout ; la liste corrigée ajoute chaque client, un doublon est ignoré et nommé"
prouver "une liste de clients qui ne s'ajoute pas en ligne" $PC \
  "    importDossiers: async (" "    importDossiersAbsent: async (" \
  "$WL1"
prouver "une ligne fausse qui laisse passer les lignes d'avant" $PC \
  "      if (faux) throw new Error(" "      if (false) throw new Error(" \
  "$WL1"
prouver "un matricule écrit avec des points refusé" $PC \
  'String(v == null ? '\'''\'' : v).toUpperCase().replace(/[\s/.\-_]/g, '\'''\'')' 'String(v == null ? '\'''\'' : v).toUpperCase().replace(/[\s/]/g, '\'''\'')' \
  "$WL1"
prouver "les coordonnées d'une liste collée perdues" $PC \
  "        await poserFiche(cree.entreprise, d, null);
        added++;" "        added++;" \
  "$WL1"

# ── Brique 53 : la visite « Travailler à plusieurs » (docs/cabinet.md, C43) ──
WV1="la visite « Travailler à plusieurs » invite par l'adresse et se joue jusqu'au bout"
prouver "la visite de l'équipe encore cachée" $PC \
  "  const VISITES_PAS_ENCORE = [
" "  const VISITES_PAS_ENCORE = [
    'equipe',
" \
  "$WV1"
prouver "la visite de l'équipe qui attend un collaborateur déclaré" $CVI \
  "      but: n0 => document.querySelectorAll('#eq-invitations [data-inv]').length > n0 && aucuneFenetre()," "      but: n0 => collaborateursActifs() > n0 && aucuneFenetre()," \
  "$WV1"
prouver "la visite de l'équipe qui déclare encore par le nom" $CVI \
  "          titre: 'Son adresse', texte:" "          titre: 'Son nom', texte:" \
  "$WV1"

# ── Brique 54 : la CNSS des seuls employeurs (docs/cabinet.md, C44) ──
EM1="employeur, mois par mois : un mois qui touche les salaires ou la CNSS l'est, un mois saisi sans eux ne l'est pas ; une écriture contre-passée et son miroir ne comptent pas"
WE2="la carte CNSS du dernier trimestre ne vise que l'employeur, plus le client saisi sans salaire"
prouver "les salaires oubliés par l'employeur" serveur/cabinet/routes.ts \
  "bool_or(l.compte like '640%' or l.compte like '4531%') employeur" "bool_or(l.compte like '4531%') employeur" \
  "$EM1"
prouver "la CNSS oubliée par l'employeur" serveur/cabinet/routes.ts \
  "bool_or(l.compte like '640%' or l.compte like '4531%') employeur" "bool_or(l.compte like '640%') employeur" \
  "$EM1"
prouver "une écriture contre-passée qui fait l'employeur" serveur/cabinet/routes.ts \
  "and e.journal <> 'AN' and e.origine_type <> 'contre_passation'
            and not exists" "and e.journal <> 'AN'
            and not exists" \
  "$EM1"
prouver "l'employeur que les Échéances ne reçoivent pas" $PC \
  "repondues: q.repondues, employeur, tenu:" "repondues: q.repondues, employeur: {}, tenu:" \
  "$WE2"
prouver "l'employeur que l'index oublie" $PC \
  "(index[e.entreprise] = index[e.entreprise] || { exercices: [], employeur: {} }).employeur[e.mois] = !!e.employeur;" "void e;" \
  "$WE2"

# ── Brique 55 : les taux par contrat de la paie d'un dossier (docs/cabinet.md, C45) ──
TR1="les taux par contrat de la paie se gardent dans la fiche, en texte décimal à quatre décimales au plus ; une forme fausse est refusée"
TR2="les taux du CIVP se gardent dans la fiche, le panneau les dit, et le bulletin d'un salarié en CIVP les suit"
prouver "un taux par contrat plus fin que le barème d'un bulletin" $CR \
  '|\d{1,2}(\.\d{1,4})?)$/);' '|\d{1,2}(\.\d{1,6})?)$/);' \
  "$TR1"
prouver "une exonération d'IRPP qui se garde fausse" $CR \
  "foprolosRate: TAUX_POUR_CENT, solidarity: TAUX_POUR_CENT, sansIrpp: z.literal(true)," "foprolosRate: TAUX_POUR_CENT, solidarity: TAUX_POUR_CENT, sansIrpp: z.boolean()," \
  "$TR1"
prouver "un régime posé sur le CDI" $CR \
  "const CONTRATS_A_REGIME = ['cdd'," "const CONTRATS_A_REGIME = ['cdi', 'cdd'," \
  "$TR1"
prouver "les taux par contrat que la fiche ne garde pas" $CR \
  "  paie: z.object({ regimesContrat: z.partialRecord(z.enum(CONTRATS_A_REGIME), REGIME_DE_CONTRAT) }).strict()," "" \
  "$TR1"
prouver "le bulletin du cabinet calculé au barème général" $PC \
  "KC.ajouterBulletin(livre, o.bulletin, paieDuDossier(o.dossierId), '', Date.now());" "KC.ajouterBulletin(livre, o.bulletin, {}, '', Date.now());" \
  "$TR2"
prouver "un taux envoyé en nombre à virgule" $PC \
  "[t, t === 'sansIrpp' ? true : String(Number(v))]" "[t, t === 'sansIrpp' ? true : Number(v)]" \
  "$TR2"
prouver "les taux par contrat jamais envoyés" $PC \
  "      contenu.paie = { regimesContrat: regimes };" "" \
  "$TR2"
prouver "le taux trop fin refusé loin de sa case" web/public/v10/cabinet/app.js \
  "          if (Math.round(n * 1e4) / 1e4 !== n) return refus(i, " "          if (false) return refus(i, " \
  "$TR2"

# ── Brique 56 : retirer un dossier du portefeuille (docs/cabinet.md, C46) ──
RD1="retirer un dossier : un dossier tenu sans écriture sort du portefeuille ; avec une écriture, refusé ; un client sur SkanFact garde ses livres"
RD2="un dossier tenu sans écriture sort du portefeuille ; celui qui a des écritures reste, et le refus dit d'archiver"
prouver "un dossier tenu retiré avec ses livres" $M32 \
  "  if exists (select 1 from socle.entreprise e where e.id = d.entreprise and e.tenue_par = d.cabinet) then" "  if false then" \
  "$RD1"
prouver "un dossier tenu retiré avec une seule écriture" $M32 \
  "    if n > 0 then" "    if n > 1 then" \
  "$RD1"
prouver "retirer un dossier qui ne fait rien" $PC \
  '      await appel('"'"'POST'"'"', `/cabinets/${cabinetId}/mandats/${d.mandat}/arreter`);' "" \
  "$RD2"
prouver "le mandat d'un dossier oublié par l'écran" $PC \
  "manual: !!d.tenu, mandat: d.mandat });" "manual: !!d.tenu, mandat: '' });" \
  "$RD2"
prouver "le bouton qui dit encore Supprimer" web/public/v10/cabinet/app.js \
  'id="del">Retirer du portefeuille…' 'id="del">Supprimer…' \
  "$RD2"
prouver "la confirmation qui dit encore Supprimer" web/public/v10/cabinet/app.js \
  "            'RETIRER', 'Retirer');" "            'RETIRER');" \
  "$RD2"
prouver "la confirmation qui tait la règle du dossier tenu" web/public/v10/cabinet/app.js \
  "Tu tiens ce dossier pour un client hors SkanFact : il ne se retire que" "Tu tiens ce dossier pour un client hors SkanFact : il se retire même" \
  "$RD2"

# ── Brique 57 : le nom et le matricule d'un dossier tenu (docs/cabinet.md, C47) ──
NT1="le nom et le matricule d'un dossier tenu : un associé les corrige, tracés ; un collaborateur, non ; ceux d'un client sur SkanFact, jamais ; un matricule déjà pris, refusé en le disant"
NT2="le dossier tenu se renomme et reçoit son matricule ; celui d'un client sur SkanFact reste le sien"
prouver "le nom d'un client sur SkanFact changé par son cabinet" $M33 \
  "  if e.tenue_par is distinct from p_cabinet then" "  if false then" \
  "$NT1"
prouver "un dossier renommé hors du portefeuille" $M33 \
  "  if not found or not exists (select 1 from socle.mandat m where m.cabinet = p_cabinet and m.entreprise = p_entreprise and m.statut = 'actif') then" "  if not found then" \
  "$NT1"
prouver "un matricule déjà pris, renommé sans un mot" $M33 \
  "  perform socle.exiger_matricule_libre(p_matricule, p_entreprise);" "" \
  "$NT1"
prouver "un matricule déjà pris, créé sans un mot" $M33 \
  "  perform socle.exiger_matricule_libre(p_matricule, null);" "" \
  "$NT1"
prouver "son propre matricule compté comme déjà pris" $M33 \
  "e.matricule_fiscal = p_matricule and e.id is distinct from p_sauf" "e.matricule_fiscal = p_matricule" \
  "$NT1"
prouver "l'organisation du dossier qui garde l'ancien nom" $M33 \
  "  update socle.organisation set nom = v_nom where id = e.organisation;" "" \
  "$NT1"
prouver "un matricule vidé écrit comme une chaîne vide" $CR \
  'corps.raisonSociale, matricule])).rows[0].avant;' 'corps.raisonSociale, matricule ?? corps.matriculeFiscal])).rows[0].avant;' \
  "$NT1"
prouver "un dossier renommé sans trace" $CR \
  "      await tracer(tx, dossier, 'cabinet.dossier_tenu.renommer', dossier, avant," "      void (tx, dossier, 'cabinet.dossier_tenu.renommer', dossier, avant," \
  "$NT1"
prouver "le nom d'un dossier tenu que l'écran n'envoie pas" $PC \
  '        await appel('"'"'PUT'"'"', `/cabinets/${cabinetId}/dossiers/${id}`, { raisonSociale: nom, matriculeFiscal: matricule });' "" \
  "$NT2"
prouver "un matricule à points envoyé tel quel" commun/matricule.ts \
  '.toUpperCase().replace(/[\s/.\-_]/g, '\'''\'');' '.toUpperCase().replace(/[\s/]/g, '\'''\'');' \
  "$NT2"
prouver "le nom d'un client sur SkanFact qui s'écrit" web/public/v10/cabinet/app.js \
  "id=\"f-name\" value=\"\${esc(d.name || '')}\" \${d.id && !d.manual ? 'readonly' : ''}>" "id=\"f-name\" value=\"\${esc(d.name || '')}\">" \
  "$NT2"
prouver "le matricule d'un dossier tenu figé par ses mois" web/public/v10/cabinet/app.js \
  "placeholder=\"1234567X/A/M/000\" \${d.id && !d.manual ? 'readonly' : ''}>" "placeholder=\"1234567X/A/M/000\" \${d.packs && d.packs.length ? 'readonly' : ''}>" \
  "$NT2"
prouver "la fiche qui parle encore de paquets" web/public/v10/cabinet/app.js \
  "Ce client est sur SkanFact : son nom et son matricule sont ceux qu'il y a donnés, lui seul les change." "Le matricule vient des paquets de ce client : c'est lui qui identifie le dossier, il ne se modifie plus ici." \
  "$NT2"
prouver "le matricule d'un dossier tenu retiré de sa fiche" web/public/v10/cabinet/app.js \
  "            // Le nom et le matricule partent avec la fiche : ceux d'un dossier tenu se corrigent (brique 57)." "            if (dossier.packs && dossier.packs.length) delete patch.matricule;" \
  "$NT2"
prouver "un matricule mal écrit refusé loin de sa case, à la création" web/public/v10/cabinet/app.js \
  "          if (!matriculeFiscalLisible(f.matricule)) return refus(" "          if (false) return refus(" \
  "$NT2"
prouver "un matricule mal écrit refusé loin de sa case, dans la fiche" web/public/v10/cabinet/app.js \
  "          if (dossier.manual && !matriculeFiscalLisible(f.matricule)) return refus(" "          if (false) return refus(" \
  "$NT2"

# ── Brique 58 : la porte nomme le cabinet sous un mandat de comptabilité (docs/cabinet.md, C48) ──
PM1="sous un mandat de comptabilité, un refus de valider nomme le cabinet, jamais le propriétaire ; sans ce mandat, il nomme le propriétaire"
prouver "un refus sous mandat qui nomme le propriétaire" serveur/porte/porte.ts \
  "  if (geste.auCabinet && perimetre === null) {" "  if (false) {" \
  "$PM1"
prouver "la validation qui n'est plus réservée au cabinet" serveur/compta/gestes.ts \
  "  { code: 'compta.ecritures.valider', module: 'compta', ecrit: true, auCabinet: 'comptabilite'," "  { code: 'compta.ecritures.valider', module: 'compta', ecrit: true," \
  "$PM1"
prouver "un mandat de paie qui prend la validation" serveur/porte/porte.ts \
  "where d.entreprise = \$1 and d.statut = 'actif' and \$2 = any(d.perimetre)\`" "where d.entreprise = \$1 and d.statut = 'actif'\`" \
  "$PM1"
prouver "un mandat proposé qui prend la validation" serveur/porte/porte.ts \
  "where d.entreprise = \$1 and d.statut = 'actif' and \$2 = any(d.perimetre)\`" "where d.entreprise = \$1 and \$2 = any(d.perimetre)\`" \
  "$PM1"

# ── Brique 59 : un exercice clos fige sa liasse (docs/cabinet.md, C49) ──
LC1="un exercice clos fige sa liasse : ni retraitement ni taux ne changent ; rouvert avec un motif, ils changent de nouveau"
LC2="un exercice clos montre sa liasse sans rien laisser changer, et dit comment rouvrir"
prouver "la liasse d'un exercice clos qui change encore" $M34 \
  "  if exists (select 1 from compta.exercice x where x.entreprise = p_entreprise and x.annee = p_annee and x.clos_le is not null) then" "  if false then" \
  "$LC1"
prouver "un exercice clos qui fige aussi l'année d'après" $M34 \
  "x.entreprise = p_entreprise and x.annee = p_annee and x.clos_le is not null" "x.entreprise = p_entreprise and x.clos_le is not null" \
  "$LC1"
prouver "la liasse qui se dit toujours ouverte" $PC \
  "etats: KC.LIASSE_ETATS, clos: !!(livre.exercice && livre.exercice.clos)," "etats: KC.LIASSE_ETATS, clos: false," \
  "$LC2"
prouver "le taux d'un exercice clos qui s'offre encore" web/public/v10/cabinet/app.js \
  "      \${liasseClose
    ? \`<p class=\"small mt\" id=\"li-close\">" "      \${false
    ? \`<p class=\"small mt\" id=\"li-close\">" \
  "$LC2"
prouver "un retraitement d'un exercice clos qui se retire encore" web/public/v10/cabinet/app.js \
  "          \${liasseClose ? '<td></td>' : \`" "          \${false ? '<td></td>' : \`" \
  "$LC2"
prouver "un retraitement qui s'ajoute encore à un exercice clos" web/public/v10/cabinet/app.js \
  "      \${liasseClose ? '' : '<div class=\"sous-table\">" "      \${false ? '' : '<div class=\"sous-table\">" \
  "$LC2"

# ── Brique 60 : le cabinet ne lit du dossier v10 que ce que son mandat demande (docs/cabinet.md, C50) ──
DV1="dans la base, le cabinet ne lit du dossier v10 du client que son plan et, sous un mandat de paie, sa paie ; le client lit tout"
M35=base/migrations/0035_dossier_v10_cabinet.sql
prouver "le cabinet qui lit tout le dossier v10" $M35 \
  "  entreprise in (select socle.mes_entreprises_entieres())
  or" "  entreprise in (select socle.mes_entreprises())
  or" \
  "$DV1"
prouver "le cabinet qui lit les réglages de la société" $M35 \
  "(collection = '_racine' and cle in ('chartAccounts', 'auxiliaires'))" "collection = '_racine'" \
  "$DV1"
prouver "le cabinet qui ne lit plus les tiers du plan" $M35 \
  "collection in ('accounts', 'clients', 'suppliers')" "collection in ('accounts', 'suppliers')" \
  "$DV1"
prouver "la paie lue sans le mandat de la paie" $M35 \
  "entreprise in (select socle.mes_entreprises_au_perimetre('paie'))" "entreprise in (select socle.mes_entreprises())" \
  "$DV1"
prouver "une entreprise vue par le cabinet comptée entière" $M35 \
  "  select e from socle.mes_entreprises() e where socle.perimetre_cabinet(e) is null" "  select e from socle.mes_entreprises() e" \
  "$DV1"
prouver "toute case du mandat qui ouvre la paie" $M35 \
  "  select e from socle.mes_entreprises() e where p_case = any(socle.perimetre_cabinet(e))" "  select e from socle.mes_entreprises() e where socle.perimetre_cabinet(e) is not null" \
  "$DV1"

# ── Brique 61 : ce qui a changé dans l'équipe (docs/cabinet.md, C51) ──
TE1="ce qui a changé dans l'équipe : l'associé le lit, du plus récent au plus ancien, avec qui l'a fait et qui est visé ; personne d'autre"
TE2="l'associé lit ce qui a changé dans l'équipe, en phrases ; le collaborateur ne voit pas la liste"
M36=base/migrations/0036_cabinet_trace_equipe.sql
prouver "la trace de l'équipe lue par un collaborateur" $M36 \
  "  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet lit ce qui a changé dans son équipe'); end if;" "" \
  "$TE1"
prouver "la trace des autres cabinets mêlée à la sienne" $M36 \
  "a.objet_type = 'cabinet' and a.objet_id = p_cabinet" "a.objet_type = 'cabinet'" \
  "$TE1"
prouver "la personne qui rejoint, sans son nom" $M36 \
  "coalesce(a.apres->>'membre', a.avant->>'membre')::uuid" "(a.avant->>'membre')::uuid" \
  "$TE1"
prouver "le nom du cabinet oublié par la trace de l'équipe" $M36 \
  "(a.geste like 'cabinet.equipe.%' or a.geste = 'cabinet.renommer')" "a.geste like 'cabinet.equipe.%'" \
  "$TE1"
prouver "la trace de l'équipe du plus ancien au plus récent" $M36 \
  "     order by a.instant desc, a.id desc" "     order by a.instant, a.id" \
  "$TE1"
prouver "la trace demandée pour un collaborateur" $PC \
  "const trace = suis ? ((await appel(" "const trace = true ? ((await appel(" \
  "$TE2"
prouver "un changement de rôle dit sans l'ancien rôle" $PC \
  "a changé le rôle de \${membre} : \${role((av.roles || [])[0])} → \${role((ap.roles || [])[0])}." "a changé le rôle de \${membre} : \${role((ap.roles || [])[0])}." \
  "$TE2"
prouver "la trace de l'équipe absente de l'écran" web/public/v10/cabinet/app.js \
  "      \${(equipe.trace || []).length ? \`<p class=\"small mt\"><b>Ce qui a changé dans l'équipe</b>" "      \${false ? \`<p class=\"small mt\"><b>Ce qui a changé dans l'équipe</b>" \
  "$TE2"

# ── Brique 62 : la reprise d'un livre du Cabinet v10, l'essai à blanc (docs/cabinet.md, C52) ──
RL1="le livre se lit : ce qui passe compté, la balance des validées égale à celle de la v10, rien de créé"
RL2="ce qui ne se reprendrait pas tel quel est nommé, écriture par écriture ; un fichier qui n'est pas un livre, refusé ; un collaborateur, refusé"
RL3="un livre de plusieurs mégaoctets se lit en une fois"
LV=serveur/reprise/livre-v10.ts
prouver "un gros livre refusé à la porte" serveur/app.ts \
  "      ...(r.limiteCorps ? { bodyLimit: r.limiteCorps } : {})," "" \
  "$RL3"
prouver "un montant à virgule lu à zéro" $LV \
  "      const debit = montant(l.debit), credit = montant(l.credit);" "      const debit = BigInt(Math.trunc(Number(l.debit) || 0)) * 1000n, credit = BigInt(Math.trunc(Number(l.credit) || 0)) * 1000n;" \
  "$RL1"
prouver "un montant trop fin arrondi en silence" $LV \
  "  try { return depuisTexte(t, 3); } catch { return null; }" "  return BigInt(Math.round(v * 1000));" \
  "$RL2"
prouver "la balance qui compte le brouillard" $LV \
  "  for (const e of validees) {" "  for (const e of l.ecritures) {" \
  "$RL1"
prouver "une écriture déséquilibrée qui passe" $LV \
  "    if (d !== c) nomme(" "    if (false) nomme(" \
  "$RL2"
prouver "une date hors de l'exercice qui passe" $LV \
  "    else if (e.date < du || e.date > au) nomme(" "    else if (false) nomme(" \
  "$RL2"
prouver "un journal inconnu qui passe" $LV \
  "    if (!(JOURNAUX_REPRIS as readonly string[]).includes(e.journal)) nomme(" "    if (false) nomme(" \
  "$RL2"
prouver "un numéro en double qui passe" $LV \
  "      else if (numeros.has(e.numeroV10)) nomme(" "      else if (false) nomme(" \
  "$RL2"
prouver "une écriture d'une seule ligne qui passe" $LV \
  "    if (e.lignes.length < 2) nomme(" "    if (false) nomme(" \
  "$RL2"
prouver "le dernier numéro d'un journal oublié" $LV \
  "if (e.numeroV10 !== null) j.dernierNumero = Math.max(j.dernierNumero ?? 0, e.numeroV10);" "" \
  "$RL1"
prouver "les lettrages oubliés par le rapport" $LV \
  "    lettrages: l.lettrages," "    lettrages: 0," \
  "$RL1"
prouver "un fichier quelconque lu comme un livre" $LV \
  "  if (!estObjet(o) || o.format !== 1 || !estObjet(o.exercice) || !Array.isArray(o.ecritures)) return null;" "  if (!estObjet(o)) return null;" \
  "$RL2"
prouver "la reprise ouverte au collaborateur" serveur/cabinet/routes.ts \
  "      if (!(await tx.query('select socle.suis_associe(\$1) a', [params.cabinet])).rows[0].a) return { statut: 403, corps: { motif: motif('cabinet.reprise.associe') } };
      const lu = lireLivreV10(corps.livre);
      if (!lu) return { statut: 400, corps: { motif: motif('cabinet.reprise.pas_un_livre'), champ: 'livre' } };
      return { corps: rapportDuLivre(lu) };" "      const lu = lireLivreV10(corps.livre);
      if (!lu) return { statut: 400, corps: { motif: motif('cabinet.reprise.pas_un_livre'), champ: 'livre' } };
      return { corps: rapportDuLivre(lu) };" \
  "$RL2"

# ── Brique 63 : la reprise d'un livre du Cabinet v10 dans un dossier tenu (docs/cabinet.md, C53) ──
RC1="les écritures s'écrivent avec leur numéro de la v10 ; la période se valide jusqu'au dernier jour tout validé ; chaque journal continue ; une seconde reprise, refusée"
RC2="un livre qui a une anomalie ne s'écrit pas ; un client sur SkanFact ne reçoit pas de reprise ; un collaborateur non plus"
# compta.reprendre_livre_v10 est redéfinie par 0038 (les lettrages) puis 0039 (les identifiants rendus
# pour les relevés) : ses preuves visent la dernière.
M39=base/migrations/0039_compta_reprise_releves.sql
prouver "une reprise écrite chez un client sur SkanFact" $M39 \
  "     or not exists (select 1 from socle.entreprise where id = p_entreprise and tenue_par is not null) then" "     or false then" \
  "$RC2"
prouver "une reprise mêlée à un livre commencé" $M39 \
  "  if exists (select 1 from compta.ecriture where entreprise = p_entreprise and date_ecriture between p_du and p_au) then" "  if false then" \
  "$RC1"
prouver "un numéro de la v10 renuméroté" $M39 \
  "    v_numero := e.journal || '-' || p_annee || '-' || lpad(e.numero::text, 6, '0');" "    v_numero := e.journal || '-' || p_annee || '-' || lpad('1', 6, '0');" \
  "$RC1"
prouver "la chaîne scellée dans le désordre" $M39 \
  "from unnest(v_ids, v_nums, v_jnx) r(id, numero, journal) order by r.numero loop" "from unnest(v_ids, v_nums, v_jnx) r(id, numero, journal) order by r.numero desc loop" \
  "$RC1"
prouver "un journal qui repart à un" $M39 \
  "    insert into compta.compteur (entreprise, journal, annee, dernier) values (p_entreprise, e.journal, p_annee, e.dernier)" "    insert into compta.compteur (entreprise, journal, annee, dernier) values (p_entreprise, e.journal, p_annee, 1)" \
  "$RC1"
prouver "la période validée par-dessus un brouillard" $M39 \
  "else least(v_derniere_validee, v_premier_brouillard - 1) end;" "else v_derniere_validee end;" \
  "$RC1"
prouver "une reprise sans l'empreinte de son fichier" $M39 \
  "  perform socle.tracer(p_entreprise, 'compta.reprise.livre_v10', 'exercice', null, null," "  perform socle.tracer(p_entreprise, 'compta.reprise.livre_v10_oubliee', 'exercice', null, null," \
  "$RC1"
prouver "un livre à anomalie envoyé à la base" serveur/cabinet/routes.ts \
  "      if (lu.anomalies.length) return { statut: 400," "      if (false) return { statut: 400," \
  "$RC2"

# ── Brique 64 : l'écran de reprise d'un livre v10 (docs/cabinet.md, C54) ──
RE1="le rapport se lit avant que rien ne s'écrive ; une anomalie bloque ; le bon livre se reprend avec ses numéros"
prouver "la reprise de la v10 absente de l'écran" web/public/v10/cabinet/app.js \
  "\${dossier.manual ? '<button class=\"btn\" id=\"lv-reprise-v10\">" "\${false ? '<button class=\"btn\" id=\"lv-reprise-v10\">" \
  "$RE1"
prouver "un livre à anomalie qu'on peut quand même écrire" web/public/v10/cabinet/app.js \
  "        \${R.anomalies.length ? '' : '<button class=\"btn btn-primary\" id=\"ok\">Reprendre ces écritures</button>'}" "        \${false ? '' : '<button class=\"btn btn-primary\" id=\"ok\">Reprendre ces écritures</button>'}" \
  "$RE1"
prouver "le livre choisi oublié entre l'essai et l'écriture" $PC \
  "      repriseEnAttente = { dossierId: o.dossierId, livre, nom: f.name };" "" \
  "$RE1"

# ── Brique 65 : les lettrages repris avec le livre v10 (docs/cabinet.md, C55) ──
RL4="une lettre qui ne se reprendrait pas telle quelle est nommée : plusieurs comptes, un brouillard, une seule écriture, un reste, une forme illisible"
RC3="l'année suivante reprise à son tour : une lettre libre se garde, une lettre prise devient la suivante libre et le résultat le dit"
RC4="la base refait les contrôles de chaque lettre : un livre envoyé sans l'essai ne pose pas un lettrage faux"
prouver "une lettre à la forme illisible qui passe l'essai" $LV \
  "    if (!/^[A-Z]{1,5}\$/.test(lettre)) nomme(" "    if (false) nomme(" \
  "$RL4"
prouver "une lettre sur deux comptes qui passe l'essai" $LV \
  "    else if (g.comptes.size > 1) nomme(" "    else if (false) nomme(" \
  "$RL4"
prouver "une lettre sur un brouillard qui passe l'essai" $LV \
  "      if (e.statut !== 'validee') g.brouillard = true;" "" \
  "$RL4"
prouver "une lettre d'une seule écriture qui passe l'essai" $LV \
  "    else if (g.ecritures.size < 2) nomme(" "    else if (false) nomme(" \
  "$RL4"
prouver "une lettre qui ne se solde pas et passe l'essai" $LV \
  "      g.comptes.add(l.compte); g.solde += l.debit - l.credit;" "      g.comptes.add(l.compte); g.solde += 0n;" \
  "$RL4"
prouver "les lettres du livre laissées à la porte" serveur/cabinet/routes.ts \
  "credit: l.credit.toString(), lettre: l.lettre }))," "credit: l.credit.toString() }))," \
  "$RC1"
prouver "les lignes d'une lettre reprise oubliées" $M39 \
  "    insert into compta.ligne_lettree (ligne, lettrage, entreprise) select u.ligne, v_lettrage, p_entreprise from unnest(g.lignes) u(ligne);" "" \
  "$RC1"
prouver "une lettre déjà prise dans le dossier, reprise telle quelle" $M39 \
  "    if exists (select 1 from compta.lettrage lt where lt.entreprise = p_entreprise and lt.lettre = v_lettre) then" "    if false then" \
  "$RC3"
prouver "une lettre renommée sur une lettre du même livre" $M39 \
  " and not (v_lettre = any (v_llettres));" ";" \
  "$RC3"
prouver "une lettre renommée sans le dire" $M39 \
  "      v_renommees := v_renommees || jsonb_build_object('v10', g.lettre, 'lettre', v_lettre);" "" \
  "$RC3"
prouver "une lettre sur deux comptes posée par la base" $M39 \
  "    if g.nc <> 1 or g.lettre" "    if false or g.lettre" \
  "$RC4"
prouver "une lettre sur un brouillard posée par la base" $M39 \
  "where l.id = any (g.lignes) and w.statut <> 'validee')" "where l.id = any (g.lignes) and false)" \
  "$RC4"
prouver "une lettre d'une seule écriture posée par la base" $M39 \
  "from compta.ligne l where l.id = any (g.lignes)) < 2" "from compta.ligne l where l.id = any (g.lignes)) < 1" \
  "$RC4"
prouver "une lettre qui ne se solde pas posée par la base" $M39 \
  "(select sum(l.debit - l.credit) from compta.ligne l where l.id = any (g.lignes)) <> 0 then" "(select sum(l.debit - l.credit) from compta.ligne l where l.id = any (g.lignes)) is null then" \
  "$RC4"
prouver "les lettrages absents du rapport à l'écran" web/public/v10/cabinet/app.js \
  "        <tr><td>Lettrages — ils se reprennent avec leur lettre</td>" "        <tr hidden><td>Lettrages — ils se reprennent avec leur lettre</td>" \
  "$RE1"
prouver "des lettres changées sans un mot à l'écran" web/public/v10/cabinet/app.js \
  "          if (r.lettres && r.lettres.length) {" "          if (false) {" \
  "$RE1"
prouver "l'écran qui ne rouvre pas le livre repris" $PC \
  "      return { ...cree, annee, livre: await livreDe(o.dossierId, annee) };" "      return { ...cree, annee, livre: null };" \
  "$RE1"

# ── Brique 66 : les relevés et leurs rapprochements repris avec le livre v10 (docs/cabinet.md, C56) ──
RL5="un relevé qui ne se reprendrait pas tel quel est nommé : ne se boucle pas, sans compte, une ligne illisible, deux fois le même fichier, un rapprochement faux ou pris deux fois"
prouver "un solde de relevé illisible qui passe l'essai" $LV \
  "    if (debut === null || fin === null) nomme(motif('reprise.releve_solde'));" "" \
  "$RL5"
prouver "un relevé sans compte qui passe l'essai" $LV \
  "    if (!COMPTE.test(r.compte)) nomme(motif('reprise.releve_compte'));" "" \
  "$RL5"
prouver "un relevé vide qui passe l'essai" $LV \
  "    if (!lignesV10.length) nomme(motif('reprise.releve_vide'));" "" \
  "$RL5"
prouver "le même relevé deux fois dans le livre" $LV \
  "    if (empreintes.has(empreinte)) nomme(motif('reprise.releve_double'));" "" \
  "$RL5"
prouver "une ligne de relevé illisible qui passe l'essai" $LV \
  "      if (m === null || !estJour(l.date)) { nomme(" "      if (!estJour(l.date)) { nomme(" \
  "$RL5"
prouver "un rapprochement vers une autre ligne que celle du compte" $LV \
  "        if (!face || face.compte !== r.compte) nomme(" "        if (!face) nomme(" \
  "$RL5"
prouver "une ligne d'écriture reprise qui répond de deux lignes de relevé" $LV \
  "        else if (faces.has(\`\${cible}#\${rangV10}\`)) nomme(" "        else if (false) nomme(" \
  "$RL5"
prouver "un relevé qui ne se boucle pas et passe l'essai" $LV \
  "r.lignes.length === lignesV10.length && debut + somme !== fin) {" "r.lignes.length === lignesV10.length && false) {" \
  "$RL5"
prouver "un relevé sans empreinte envoyé tel quel" $LV \
  "    const empreinte = /^[0-9a-f]{64}\$/.test(String(x.empreinte ?? '')) ? String(x.empreinte)" "    const empreinte = true ? String(x.empreinte ?? '')" \
  "$RC3"
prouver "les relevés du livre laissés de côté" serveur/cabinet/routes.ts \
  "      for (const r of lu.releves) {" "      for (const r of lu.releves.slice(0, 0)) {" \
  "$RC1"
prouver "un rapprochement relié à la place de la v10 et non à la ligne écrite" serveur/cabinet/routes.ts \
  "            const rang = e ? e.rangs.indexOf(l.face.rangV10) + 1 : 0;" "            const rang = e ? l.face.rangV10 + 1 : 0;" \
  "$RC1"
prouver "le niveau d'un rapprochement repris perdu" serveur/cabinet/routes.ts \
  "ecritureLigne: lignesEcrites.get(\`\${e?.id}#\${rang}\`) ?? null, niveau: l.face.niveau, auto: l.face.auto });" "ecritureLigne: lignesEcrites.get(\`\${e?.id}#\${rang}\`) ?? null, niveau: 'probable', auto: false });" \
  "$RC1"
prouver "le jugement « à confirmer » d'une ligne perdu" serveur/cabinet/routes.ts \
  "          } else if (l.niveau !== 'aucun') poses.push(" "          } else if (false) poses.push(" \
  "$RC1"
prouver "les rapprochements repris comptés à zéro" serveur/cabinet/routes.ts \
  "            rapprochees++;" "" \
  "$RC1"
prouver "les identifiants internes rendus au navigateur" serveur/cabinet/routes.ts \
  "      return { statut: 201, corps: { ...resultat, releves:" "      return { statut: 201, corps: { ...cree, releves:" \
  "$RC1"
prouver "les écritures reprises sans leur identifiant rendu" $M39 \
  "    v_toutes := v_toutes || v_id;" "" \
  "$RC1"
prouver "les relevés absents du rapport à l'écran" web/public/v10/cabinet/app.js \
  "        <tr><td>Relevés bancaires — avec leurs rapprochements</td>" "        <tr hidden><td>Relevés bancaires — avec leurs rapprochements</td>" \
  "$RE1"

# ── Brique 67 : les immobilisations reprises avec le livre v10 (docs/cabinet.md, C57) ──
RI1="chaque bien est posé une fois, relié à la dotation reprise et à la facture dont il est né ; l'année suivante le retrouve"
RI2="un bien déjà dans le dossier avec un autre plan : la reprise s'arrête en le disant, rien n'est écrit"
RI3="un bien qui ne se reprendrait pas tel quel est nommé : sans libellé, un compte, une date, un montant, une durée, un taux illisibles, une écriture absente ou qui n'est pas la sienne"
RI4="la base refait ses contrôles : une écriture qui n'est pas reprise, un genre inconnu, une dotation reliée deux fois, un dossier qui n'est pas tenu"
RE2="les immobilisations reprises : le bien reporté ne se propose pas comme une acquisition, celui né de sa facture non plus, leurs dotations sont passées"
M40=base/migrations/0040_compta_reprise_immobilisations.sql
prouver "un bien sans libellé qui passe l'essai" $LV \
  "    if (!libelle) nomme(motif('reprise.immo_libelle'));" "" \
  "$RI3"
prouver "un compte de bien illisible qui passe l'essai" $LV \
  "    if (comptes.some((c) => !COMPTE.test(c))) nomme(motif('reprise.immo_compte'));" "" \
  "$RI3"
prouver "une date de bien illisible qui passe l'essai" $LV \
  "    if (!estJour(mes) || (ces && !estJour(ces.date))) nomme(motif('reprise.immo_date'));" "" \
  "$RI3"
prouver "un montant de bien illisible qui passe l'essai" $LV \
  "    if (valeurs.some((v) => v === null)) nomme(motif('reprise.immo_montant'));" "" \
  "$RI3"
prouver "une durée illisible qui passe l'essai" $LV \
  "    if (duree === null) nomme(motif('reprise.immo_duree'));" "" \
  "$RI3"
prouver "un taux dégressif illisible qui passe l'essai" $LV \
  "    if (taux === null && x.tauxDegressif !== null" "    if (false && x.tauxDegressif !== null" \
  "$RI3"
prouver "une dotation vers une écriture absente qui passe l'essai" $LV \
  "      if (!e) { nomme(motif('reprise.immo_ecriture', { annee: String(annee) })); continue; }" "      if (!e) continue;" \
  "$RI3"
prouver "une écriture qui n'est ni la dotation ni la sortie du bien, reliée" $LV \
  "      if (!genre) nomme(motif('reprise.immo_genre'" "      if (false) nomme(motif('reprise.immo_genre'" \
  "$RI3"
prouver "l'écriture d'une autre année reliée au bien reporté" $LV \
  "      if (!estObjet(l) || Number(l.annee) !== annee || !texte(l.ecritureId, 200)) continue;" "      if (!estObjet(l) || !texte(l.ecritureId, 200)) continue;" \
  "$RI1"
prouver "les biens absents du rapport" $LV \
  "    immobilisations: { total: l.biens.length, liees:" "    immobilisations: { total: 0, liees:" \
  "$RI1"
prouver "le bien né d'une écriture qui perd son origine" $LV \
  "      docRef: doc && parRef.has(doc[1] ?? '') ? {" "      docRef: false ? {" \
  "$RI1"
prouver "l'origine d'un bien laissée à l'écriture de la v10" serveur/cabinet/routes.ts \
  "        const docId = nee && b.docRef ? \`\${nee.id}#\${nee.rangs.indexOf(b.docRef.rangV10)}\` : b.fiche.origine.docId;" "        const docId = nee && b.docRef ? \`\${nee.id}#\${b.docRef.rangV10}\` : b.fiche.origine.docId;" \
  "$RI1"
prouver "les dotations reprises laissées sans leur bien" serveur/cabinet/routes.ts \
  "        const liens = b.liens.map((l) => ({ genre: l.genre, ecriture: ecritureDe.get(l.ecriture)?.id ?? null }));" "        const liens: unknown[] = [];" \
  "$RI1"
prouver "un bien retrouvé compté comme créé" serveur/cabinet/routes.ts \
  "        if (r.cree) immobilisations.creees++; else immobilisations.retrouvees++;" "        immobilisations.creees++;" \
  "$RI1"
prouver "les écritures reliées aux biens comptées à zéro" serveur/cabinet/routes.ts \
  "        immobilisations.liees += r.liees;" "" \
  "$RI1"
prouver "une reprise de bien chez un client sur SkanFact" $M40 \
  "  if socle.perimetre_cabinet(p_entreprise) is null
     or not exists (select 1 from socle.entreprise where id = p_entreprise and tenue_par is not null) then
    perform socle.refus('la reprise d''un livre de la v10 s''écrit dans un dossier que ton cabinet tient');
  end if;" "" \
  "$RI4"
prouver "un bien d'une autre année recréé en double" $M40 \
  "  select * into x from compta.immobilisation i where i.entreprise = p_entreprise and i.fiche->'libelle' = p_fiche->'libelle'" "  select * into x from compta.immobilisation i where false and i.fiche->'libelle' = p_fiche->'libelle'" \
  "$RI1"
prouver "un bien retrouvé dont le plan diffère, repris quand même" $M40 \
  "      if (x.fiche->k) is distinct from (p_fiche->k) then" "      if false then" \
  "$RI2"
prouver "une écriture saisie reliée comme une dotation reprise" $M40 \
  "and e.origine_type = 'reprise_v10' and extract" "and true and extract" \
  "$RI4"
prouver "un genre de lien inconnu" $M40 \
  "    if coalesce(l->>'genre', '') not in ('dotation', 'cession')" "    if false" \
  "$RI4"
prouver "une dotation reliée deux fois" $M40 \
  "    if exists (select 1 from compta.immobilisation_ecriture i where i.immobilisation = v_id" "    if false and exists (select 1 from compta.immobilisation_ecriture i where i.immobilisation = v_id" \
  "$RI4"
prouver "un bien posé dit retrouvé" $M40 \
  "    v_cree := true;" "" \
  "$RI1"
prouver "un bien reporté qui se propose comme une acquisition" $PC \
  "    livre.immobilisations = biens.map((/** @type {any} */ b) => (String(b.dateMiseEnService || b.dateAcquisition || '') < livre.exercice.du ? { ...b, reporteDe: Number(annee) - 1 } : b));" "    livre.immobilisations = biens;" \
  "$RE2"
prouver "les biens absents du rapport à l'écran" web/public/v10/cabinet/app.js \
  "        <tr><td>Immobilisations — une fiche par bien" "        <tr hidden><td>Immobilisations — une fiche par bien" \
  "$RE1"

# ── Brique 68 : la révision et les questions reprises avec le livre v10 (docs/cabinet.md, C58) ──
RQ1="une révision ou une question qui ne se reprendrait pas telle quelle est nommée ; la base refait ses contrôles"
M41=base/migrations/0041_compta_reprise_questions.sql
prouver "une révision d'une autre année qui passe l'essai" $LV \
  "    if (!periodeDuLivre(periode, annee)) { nomme(" "    if (false) { nomme(" \
  "$RQ1"
prouver "une révision deux fois dans le livre" $LV \
  "    if (vues.has(periode)) { nomme(motif('reprise.revision_double')); continue; }" "" \
  "$RQ1"
prouver "une révision illisible reprise en silence" $LV \
  "    if (!lu.success) { nomme(" "    if (!lu.success) { continue; nomme(" \
  "$RQ1"
prouver "une révision arrêtée reprise ouverte" $LV \
  "      faite: x.faite === true, faiteLe:" "      faite: false, faiteLe:" \
  "$RC1"
prouver "une question d'une autre année qui passe l'essai" $LV \
  "    if (!periodeDuLivre(q.periode, annee)) nomme(" "    if (false) nomme(" \
  "$RQ1"
prouver "une question sans texte qui passe l'essai" $LV \
  "    if (!q.texte) nomme(" "    if (false) nomme(" \
  "$RQ1"
prouver "le compte illisible d'une question qui passe l'essai" $LV \
  "    if (q.compte && !COMPTE.test(q.compte)) nomme(" "    if (false) nomme(" \
  "$RQ1"
prouver "le montant illisible d'une question qui passe l'essai" $LV \
  "    if (montant(x.montant) === null) nomme(" "    if (false) nomme(" \
  "$RQ1"
prouver "l'état inconnu d'une question qui passe l'essai" $LV \
  "    if (!(STATUTS as readonly string[]).includes(String(x.statut))) nomme(" "    if (false) nomme(" \
  "$RQ1"
prouver "une question répondue sans réponse qui passe l'essai" $LV \
  "    else if ((q.statut === 'repondue') !== (q.reponse !== null) && q.statut !== 'close') nomme(" "    else if (false) nomme(" \
  "$RQ1"
prouver "une question envoyée sans envoi qui passe l'essai" $LV \
  "    else if ((q.statut === 'ouverte') !== (q.envois.length === 0) && q.statut !== 'close') nomme(" "    else if (false) nomme(" \
  "$RQ1"
prouver "les révisions absentes du rapport" $LV \
  "    revisions: { total: l.revisions.length," "    revisions: { total: 0," \
  "$RL1"
prouver "les questions absentes du rapport" $LV \
  "    questions: { total: l.questions.length," "    questions: { total: 0," \
  "$RL1"
prouver "les révisions du livre laissées de côté" serveur/cabinet/routes.ts \
  "      for (const r of lu.revisions) {" "      for (const r of lu.revisions.slice(0, 0)) {" \
  "$RC1"
prouver "une question reprise sans sa pièce" serveur/cabinet/routes.ts \
  "        ...q, montant: q.montant.toString(), ecriture: ecritureDe.get(q.ecriture)?.id ?? null," "        ...q, montant: q.montant.toString(), ecriture: null," \
  "$RC1"
prouver "une question reprise chez un client sur SkanFact" $M41 \
  "  if socle.perimetre_cabinet(p_entreprise) is null
     or not exists (select 1 from socle.entreprise where id = p_entreprise and tenue_par is not null) then
    perform socle.refus('la reprise d''un livre de la v10 s''écrit dans un dossier que ton cabinet tient');
  end if;" "" \
  "$RQ1"
prouver "une question reprise en face d'une écriture saisie" $M41 \
  "and e.entreprise = p_entreprise and e.origine_type = 'reprise_v10') then" "and e.entreprise = p_entreprise) then" \
  "$RQ1"
prouver "les envois d'une question reprise perdus" $M41 \
  "            coalesce((select array_agg(to_timestamp(x::bigint / 1000.0) order by o) from jsonb_array_elements_text(q->'envois') with ordinality t(x, o)), '{}')," "            '{}'," \
  "$RC1"
prouver "l'instant de la réponse d'une question reprise perdu" $M41 \
  "            nullif(q->>'reponse', ''), case when q->>'repondue' is null then null else to_timestamp((q->>'repondue')::bigint / 1000.0) end," "            nullif(q->>'reponse', ''), null," \
  "$RC1"
prouver "la révision absente du rapport à l'écran" web/public/v10/cabinet/app.js \
  "        <tr><td>Révision — le dossier de travail de chaque période</td>" "        <tr hidden><td>Révision — le dossier de travail de chaque période</td>" \
  "$RE1"
prouver "les questions absentes du rapport à l'écran" web/public/v10/cabinet/app.js \
  "        <tr><td>Questions au client — dans leur état</td>" "        <tr hidden><td>Questions au client — dans leur état</td>" \
  "$RE1"

# ── Brique 69 : les déclarations et l'inventaire repris avec le livre v10 (docs/cabinet.md, C59) ──
RD1="la déclaration reprise avec ses cases, son dépôt, son paiement et son écriture ; l'inventaire avec ses lignes et sa variation ; ni l'une ni l'autre ne se repasse"
RD2="une déclaration ou un inventaire qui ne se reprendrait pas tel quel est nommé ; la base refait ses contrôles"
M42=base/migrations/0042_compta_reprise_declarations.sql
prouver "une déclaration d'une autre année qui passe l'essai" $LV \
  "{ nomme(motif('reprise.declaration_periode', { annee: String(annee) })); continue; }" "{ continue; }" \
  "$RD2"
prouver "une déclaration deux fois dans le livre" $LV \
  "    if (vues.has(periode)) { nomme(motif('reprise.declaration_double')); continue; }" "" \
  "$RD2"
prouver "une case inconnue qui passe l'essai" $LV \
  "      if (!CASES_DECLARATION.includes(k)) { nomme(motif('reprise.declaration_case', { case: k })); continue; }" "" \
  "$RD2"
prouver "une case illisible qui passe l'essai" $LV \
  "      if (m === null && brute !== null && brute !== undefined && brute !== '') { nomme(" "      if (false) { nomme(" \
  "$RD2"
prouver "un jour de dépôt illisible qui passe l'essai" $LV \
  "    if ((dep && !estJour(dep.le)) || (pay && !estJour(pay))) nomme(motif('reprise.declaration_jour'));" "" \
  "$RD2"
prouver "une déclaration payée sans dépôt qui passe l'essai" $LV \
  "    if (pay && !dep) nomme(" "    if (false) nomme(" \
  "$RD2"
prouver "l'écriture absente d'une déclaration qui passe l'essai" $LV \
  "    if (ecriture && !refs.has(ecriture)) nomme(motif('reprise.declaration_ecriture'));" "" \
  "$RD2"
prouver "deux inventaires qui passent l'essai" $LV \
  "  if (tous.length > 1) nomme(" "  if (false) nomme(" \
  "$RD2"
prouver "un inventaire d'une autre année qui passe l'essai" $LV \
  "  if (!estJour(date) || date.slice(0, 4) !== String(annee)) nomme(" "  if (false) nomme(" \
  "$RD2"
prouver "le compte de stock illisible qui passe l'essai" $LV \
  "  if (!COMPTE.test(compte)) nomme(motif('reprise.inventaire_compte'));" "" \
  "$RD2"
prouver "une ligne d'inventaire sans désignation qui passe l'essai" $LV \
  "    if (!texte(l.libelle, 200).trim() || quantite === null" "    if (quantite === null" \
  "$RD2"
prouver "une quantité négative qui passe l'essai" $LV \
  "|| quantite === null || cout === null || quantite < 0n || cout < 0n) { nomme(" "|| quantite === null || cout === null) { nomme(" \
  "$RD2"
prouver "l'écriture absente de l'inventaire qui passe l'essai" $LV \
  "  if (ecriture && !refs.has(ecriture)) nomme(motif('reprise.inventaire_ecriture'));" "" \
  "$RD2"
prouver "les déclarations absentes du rapport" $LV \
  "    declarations: { total: l.declarations.length," "    declarations: { total: 0," \
  "$RD1"
prouver "l'inventaire absent du rapport" $LV \
  "    inventaire: l.inventaire ? { lignes: l.inventaire.lignes.length } : null," "    inventaire: null," \
  "$RD1"
prouver "les déclarations du livre laissées de côté" serveur/cabinet/routes.ts \
  "      for (const d of lu.declarations) {" "      for (const d of lu.declarations.slice(0, 0)) {" \
  "$RD1"
prouver "une déclaration reprise sans son écriture" serveur/cabinet/routes.ts \
  "payee: d.payee, ecriture: ecritureDe.get(d.ecriture)?.id ?? null," "payee: d.payee, ecriture: null," \
  "$RD1"
prouver "l'inventaire du livre laissé de côté" serveur/cabinet/routes.ts \
  "      if (lu.inventaire) {" "      if (false) {" \
  "$RD1"
prouver "un inventaire repris sans sa variation" serveur/cabinet/routes.ts \
  "          ecriture: ecritureDe.get(inv.ecriture)?.id ?? null," "          ecriture: null," \
  "$RD1"
prouver "une déclaration reprise chez un client sur SkanFact" $M42 \
  "v_ecriture uuid := nullif(p_declaration->>'ecriture', '')::uuid;
begin
  if socle.perimetre_cabinet(p_entreprise) is null
     or not exists (select 1 from socle.entreprise where id = p_entreprise and tenue_par is not null) then
    perform socle.refus('la reprise d''un livre de la v10 s''écrit dans un dossier que ton cabinet tient');
  end if;" "v_ecriture uuid := nullif(p_declaration->>'ecriture', '')::uuid;
begin" \
  "$RD2"
prouver "un inventaire repris chez un client sur SkanFact" $M42 \
  "v_ecriture uuid := nullif(p_inventaire->>'ecriture', '')::uuid;
begin
  if socle.perimetre_cabinet(p_entreprise) is null
     or not exists (select 1 from socle.entreprise where id = p_entreprise and tenue_par is not null) then
    perform socle.refus('la reprise d''un livre de la v10 s''écrit dans un dossier que ton cabinet tient');
  end if;" "v_ecriture uuid := nullif(p_inventaire->>'ecriture', '')::uuid;
begin" \
  "$RD2"
prouver "une déclaration liée à une écriture saisie" $M42 \
  "and e.origine_type = 'reprise_v10') then
    perform socle.refus('l''écriture liée à une déclaration ou à un inventaire repris n''est pas une écriture reprise de ce dossier');
  end if;
  v_id :=" "and true) then
    perform socle.refus('l''écriture liée à une déclaration ou à un inventaire repris n''est pas une écriture reprise de ce dossier');
  end if;
  v_id :=" \
  "$RD2"
prouver "un inventaire lié à une écriture saisie" $M42 \
  "and e.origine_type = 'reprise_v10') then
    perform socle.refus('l''écriture liée à une déclaration ou à un inventaire repris n''est pas une écriture reprise de ce dossier');
  end if;
  v_total :=" "and true) then
    perform socle.refus('l''écriture liée à une déclaration ou à un inventaire repris n''est pas une écriture reprise de ce dossier');
  end if;
  v_total :=" \
  "$RD2"
prouver "le dépôt d'une déclaration reprise perdu" $M42 \
  "    deposee_le = (p_declaration->'deposee'->>'le')::date," "    deposee_le = null," \
  "$RD1"
prouver "le jour de préparation d'une déclaration reprise perdu" $M42 \
  "then to_timestamp((p_declaration->>'preparee')::bigint / 1000.0) else preparee_le end," "then preparee_le else preparee_le end," \
  "$RD1"
prouver "une déclaration reprise sans le lien de son écriture" $M42 \
  "    ecriture = v_ecriture
   where id = v_id;" "    ecriture = null
   where id = v_id;" \
  "$RD1"
prouver "un inventaire repris sans le lien de sa variation" $M42 \
  "  update compta.inventaire set ecriture = v_ecriture where" "  update compta.inventaire set ecriture = null where" \
  "$RD1"
prouver "les déclarations absentes du rapport à l'écran" web/public/v10/cabinet/app.js \
  "        <tr><td>Déclarations du mois — avec leur dépôt et leur paiement</td>" "        <tr hidden><td>Déclarations du mois — avec leur dépôt et leur paiement</td>" \
  "$RE1"
prouver "l'inventaire absent du rapport à l'écran" web/public/v10/cabinet/app.js \
  "        <tr><td>Inventaire de stock</td>" "        <tr hidden><td>Inventaire de stock</td>" \
  "$RE1"

# ── Brique 70 : le portefeuille du Cabinet v10 repris (docs/cabinet.md, C60) ──
RP1="les dossiers tenus créés avec leur fiche ; les clients sur SkanFact et les exemples dits ; une seconde reprise les retrouve"
RP2="ce qui ne se reprendrait pas tel quel est nommé et rien ne se crée ; un champ de plus (la clé privée) refusé ; un collaborateur refusé"
RW1="le rapport se lit avant que rien ne se crée ; une anomalie bloque ; le bon fichier crée les dossiers tenus, sans que la clé parte"
CV=serveur/reprise/cabinet-v10.ts
prouver "un champ de plus d'un dossier accepté (la clé d'un client)" $CV \
  "  relances: z.array(z.unknown()).max(200), abonnements: z.array(z.unknown()).max(200),
}).strict();" "  relances: z.array(z.unknown()).max(200), abonnements: z.array(z.unknown()).max(200),
});" \
  "$RP2"
prouver "la clé privée du cabinet acceptée à côté des dossiers" $CV \
  "export const PORTEFEUILLE_V10 = z.object({ dossiers: z.array(DOSSIER_V10).max(2000) }).strict();" "export const PORTEFEUILLE_V10 = z.object({ dossiers: z.array(DOSSIER_V10).max(2000) });" \
  "$RP2"
prouver "un dossier d'exemple repris comme un vrai" $CV \
  "    if (d.demo) { exemples++; continue; }" "" \
  "$RP1"
prouver "un client sur SkanFact repris comme un dossier tenu" $CV \
  "    if (!d.manual) { surSkanfact.push(nom); continue; }" "" \
  "$RP1"
prouver "un dossier sans nom qui passe l'essai" $CV \
  "    if (!nom || nom.length > 200) nomme(" "    if (false) nomme(" \
  "$RP2"
prouver "un matricule illisible qui passe l'essai" $CV \
  "    if (lu === undefined) nomme(" "    if (false) nomme(" \
  "$RP2"
prouver "un matricule en double dans le fichier qui passe l'essai" $CV \
  "    else if (lu && matricules.has(lu)) nomme(" "    else if (false) nomme(" \
  "$RP2"
prouver "un matricule à points de la v10 refusé" commun/matricule.ts \
  '.toUpperCase().replace(/[\s/.\-_]/g, '\'''\'');' '.toUpperCase().replace(/[\s/]/g, '\'''\'');' \
  "$RP1"
prouver "des honoraires illisibles qui passent l'essai" $CV \
  "    if (fees === null) nomme(motif('reprise.dossier_honoraires'));" "" \
  "$RP2"
prouver "les honoraires repris à zéro" $CV \
  "fees: Number(fees)," "fees: 0," \
  "$RP1"
prouver "le montant d'un abonnement repris tel quel, sans ses millimes" $CV \
  "montant: m === null ? String(x.montant) : versTexte(m, 3)," "montant: String(x.montant)," \
  "$RP1"
prouver "une fiche illisible qui passe l'essai" serveur/cabinet/routes.ts \
  "      if (!f.success) anomalies.push(" "      if (false) anomalies.push(" \
  "$RP2"
prouver "un dossier déjà au portefeuille recréé" serveur/cabinet/routes.ts \
  "    const aCreer = lu.dossiers.filter((d) => !retrouve(d));" "    const aCreer = lu.dossiers;" \
  "$RP1"
prouver "un portefeuille à anomalie créé quand même" serveur/cabinet/routes.ts \
  "      if (rapport.anomalies.length) return { statut: 400, corps: { motif: motif('cabinet.reprise.portefeuille_anomalies'" "      if (false) return { statut: 400, corps: { motif: motif('cabinet.reprise.portefeuille_anomalies'" \
  "$RP2"
prouver "l'essai du portefeuille ouvert au collaborateur" serveur/cabinet/routes.ts \
  "      if (!(await tx.query('select socle.suis_associe(\$1) a', [params.cabinet])).rows[0].a) return { statut: 403, corps: { motif: motif('cabinet.reprise.portefeuille_associe') } };
      return { corps: (await lirePortefeuille(" "      return { corps: (await lirePortefeuille(" \
  "$RP2"
prouver "la reprise du portefeuille ouverte au collaborateur" serveur/cabinet/routes.ts \
  "      if (!(await tx.query('select socle.suis_associe(\$1) a', [cabinet])).rows[0].a) return { statut: 403, corps: { motif: motif('cabinet.reprise.portefeuille_associe') } };
      const { aCreer, rapport }" "      const { aCreer, rapport }" \
  "$RP2"
prouver "les dossiers repris sans leur fiche" serveur/cabinet/routes.ts \
  "        await requetes(tx).insertInto('cabinet.fiche').values({ cabinet, entreprise: id, contenu: JSON.stringify(d.fiche), modifie_par: qui.utilisateur }).execute();" "" \
  "$RP1"
prouver "le fichier du cabinet envoyé tel quel (sa clé privée)" $PC \
  "  const portefeuilleAEnvoyer = (etat) => ({ dossiers: (etat.dossiers || []).map((/** @type {any} */ d) => Object.fromEntries(CHAMPS_PORTEFEUILLE.map((k) => [k, d[k]]))) });" "  const portefeuilleAEnvoyer = (etat) => etat;" \
  "$RW1"
prouver "le portefeuille lu oublié entre l'essai et la création" $PC \
  "      portefeuilleEnAttente = corps;" "" \
  "$RW1"
prouver "la reprise du portefeuille absente de la page vide" web/public/v10/cabinet/app.js \
  "            <button class=\"btn\" id=\"rp-v10\">Reprendre mon portefeuille de SkanFact Cabinet v10…</button>" "" \
  "$RW1"
prouver "un portefeuille à anomalie qu'on peut quand même créer" web/public/v10/cabinet/app.js \
  "        \${n || !k ? '' : \`<button class=\"btn btn-primary\" id=\"ok\">Créer" "        \${!k ? '' : \`<button class=\"btn btn-primary\" id=\"ok\">Créer" \
  "$RW1"

# ── Brique 72 : l'application installable, qui s'ouvre et se consulte sans réseau (docs/hors-ligne.md) ──
HL1="sur mon ordinateur : la copie chiffrée ; sans réseau, l'entreprise se rouvre et se consulte ; le réseau revenu, on recharge ; déconnecté, le poste oublie"
HL2="sur l'ordinateur d'un autre : rien n'est gardé, et sans réseau l'écran le dit"
HL4="une page mise à jour, vue en ligne, est celle qui s'ouvre sans réseau"
HL3="par l'entrée : mon ordinateur garde la session, le poste d'un autre non ; la même personne retrouve ce que le poste gardait, une autre le trouve effacé"
prouver "la clé de l'appareil exportable" web/public/plateforme/poste.js \
  "{ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']" "{ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']" \
  "$HL1"
prouver "la copie du poste gardée en clair" web/public/plateforme/poste.js \
  "    const chiffre = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cle(), new TextEncoder().encode(JSON.stringify(contenu)));" "    const chiffre = new TextEncoder().encode(JSON.stringify(contenu)).buffer;" \
  "$HL1"
prouver "une copie gardée sur l'ordinateur d'un autre" web/public/plateforme/poste.js \
  "  const garde = () => { try { return !!localStorage.getItem('skanfact.jeton'); } catch { return false; } };" "  const garde = () => true;" \
  "$HL2"
prouver "la copie qui survit à la déconnexion" web/public/plateforme/poste.js \
  "    await new Promise((ok) => { const r = indexedDB.deleteDatabase(BASE); r.onsuccess = r.onerror = r.onblocked = () => ok(undefined); });" "" \
  "$HL1"
prouver "le bandeau qui tait de quand date la copie" web/public/plateforme/poste.js \
  "    if (o.copieLe) copieLue = o.copieLe;
" "" \
  "$HL1"
prouver "le réseau revenu sans « Recharger »" web/public/plateforme/poste.js \
  "    if (!copieLue) { cacher(); return; }" "    cacher(); return;" \
  "$HL1"
prouver "le retour du réseau qu'on n'entend pas" web/public/plateforme/poste.js \
  "  window.addEventListener('online', () => enLigne(false));
" "" \
  "$HL1"
prouver "l'écran vide sans un mot, hors ligne et sans copie" web/public/plateforme/poste.js \
  "    poser(\`<span><strong>\${motif.replace(" "    void (\`<span><strong>\${motif.replace(" \
  "$HL2"
prouver "hors ligne, la copie du poste jamais ouverte" $PONT \
  "        if (!/** @type {any} */ (e).horsLigne) throw e;
        const copie = avecTicketsEnAttente(await lireLaCopie());" "        throw e;
        const copie = avecTicketsEnAttente(await lireLaCopie());" \
  "$HL1"
prouver "la copie jamais écrite après une lecture" $PONT \
  "    questionsLues = data.questionsCabinet;
    garderLaCopie();
" "    questionsLues = data.questionsCabinet;
" \
  "$HL1"
prouver "la session gardée après « Se déconnecter »" $PONT \
  "sessionStorage.removeItem('skanfact.jeton'); localStorage.removeItem('skanfact.jeton'); } catch { /* rien à retirer */ }
      await poste.effacer();" "sessionStorage.removeItem('skanfact.jeton'); } catch { /* rien à retirer */ }
      await poste.effacer();" \
  "$HL1"
prouver "la session du navigateur ignorée par l'application" $PONT \
  "jeton = sessionStorage.getItem('skanfact.jeton') || localStorage.getItem('skanfact.jeton');" "jeton = sessionStorage.getItem('skanfact.jeton');" \
  "$HL1"
prouver "l'entrée qui, sans réseau, n'ouvre pas la copie" web/src/App.tsx \
  "      if (copie) { location.assign(\`/v10/?e=\${encodeURIComponent(copie)}\`); return; }
" "" \
  "$HL1"
prouver "la session jamais gardée sur mon ordinateur" web/src/api.ts \
  "ecrire('skanfact.jeton', garder ? j : null, localStorage);" "ecrire('skanfact.jeton', null, localStorage);" \
  "$HL3"
prouver "la session gardée sur le poste d'un autre" web/src/api.ts \
  "ecrire('skanfact.jeton', garder ? j : null, localStorage);" "ecrire('skanfact.jeton', j, localStorage);" \
  "$HL3"
prouver "les copies d'une autre personne qui survivent à sa connexion" web/src/api.ts \
  "    if (avant && avant !== id) effacerLePoste();
" "" \
  "$HL3"
prouver "la personne connectée jamais notée par l'entrée" web/src/App.tsx \
  "      session.personne(r.corps.id);
" "" \
  "$HL3"
prouver "la case « poste de quelqu'un d'autre » sans effet" web/src/ecrans/Connexion.tsx \
  "      session.ouvrir(r.corps.jeton, !posteDUnAutre);" "      session.ouvrir(r.corps.jeton, true);" \
  "$HL3"
prouver "la case « poste de quelqu'un d'autre » oubliée au code" web/src/ecrans/Code.tsx \
  "session.ouvrir(r.corps.jeton, !defi.posteDUnAutre);" "session.ouvrir(r.corps.jeton, true);" \
  "$HL3"
prouver "le menu fermé sans réseau (plus de « Se déconnecter »)" $PONT \
  "        if (!/** @type {any} */ (e).horsLigne) throw e;
        // Sans réseau : l'entreprise ouverte seulement" "        throw e;
        // Sans réseau : l'entreprise ouverte seulement" \
  "$HL1"
prouver "les écrans jamais gardés pour le hors-ligne" web/public/sw.js \
  "        await c.put(cle, r.clone());
" "" \
  "$HL4"
prouver "sans réseau, les écrans gardés jamais servis" web/public/sw.js \
  "      const garde = (await caches.match(cle)) || (navigation ? await caches.match('/') : undefined);
      if (garde) return garde;
" "" \
  "$HL1"

# ── Brique 73 : enregistrer sans réseau (docs/hors-ligne.md, H5 à H7) ──
HE1="un client créé sans réseau se garde sur le poste, se montre au rechargement, et part seul au retour du réseau"
HE2="un client changé sans réseau et ailleurs : la version du serveur gardée, la mienne mise de côté et dite (page ouverte)"
HE3="rouverte plus tard avec le réseau : ce qui attendait part d'abord ; changé ailleurs, la version du serveur gardée et la mienne mise de côté"
HE5="la session finie pendant la coupure : se reconnecter, et ce qui attendait part"
HE4="se déconnecter avec des changements qui attendent : la question d'abord ; « Attendre le réseau » ne perd rien"
prouver "sans réseau, l'enregistrement refusé au lieu d'être gardé" $PONT \
  "        if (gardableHorsLigne(e)) return await mettreEnAttente(data);
        // Le matricule de la fiche, seul refusé" "        // Le matricule de la fiche, seul refusé" \
  "$HE1"
prouver "ce qui attend le réseau jamais gardé sur le poste" $PONT \
  "    await poste.ecrireAttente(ent, { data });
" "" \
  "$HE1"
prouver "ce qui est parti, encore gardé sur le poste" $PONT \
  "    await poste.effacerAttente(ent);
    poste.envoye(n, conflits);" "    poste.envoye(n, conflits);" \
  "$HE1"
prouver "le retour du réseau qui ne relance rien" $PONT \
  "  poste.auRetour(relancer);
" "" \
  "$HE1"
prouver "l'envoi réussi qui tait ce qui attendait" $PONT \
  "        if (r === true && attenteGardee) await finirAttente(0);
" "" \
  "$HE1"
prouver "rechargée sans réseau, ce qui attend disparaît de l'écran" $PONT \
  "        return { data: attente.contenu.data, corruptFile: null };" "        return { data: copie, corruptFile: null };" \
  "$HE1"
prouver "rouverte avec le réseau, ce qui attendait jamais envoyé" $PONT \
  "        const data = avecTicketsEnAttente(attente ? await rejouer(attente.contenu.data) : await relire());" "        const data = avecTicketsEnAttente(await relire());" \
  "$HE3"
prouver "rouverte, une pièce changée ailleurs qui écrase la mienne sans la garder" $PONT \
  "        const m = /** @type {any} */ (window).SkanCore.mergeData(data, r.disk);
        conflits = m.counts.conflicts || 0;
        r = await envoyer(m.data);" "        r = await envoyer(r.disk);" \
  "$HE3"
prouver "rouverte, le conflit passé sous silence" $PONT \
  "        conflits = m.counts.conflicts || 0;
" "" \
  "$HE3"
prouver "se déconnecter sans demander, des changements en attente" $PONT \
  "      if (attenteGardee && !(await poste.demander(" "      if (false && !(await poste.demander(" \
  "$HE4"
prouver "les réglages du dossier comptés comme des changements" $PONT \
  "  const compter = (changements) => changements.filter((c) => c.collection !== '_racine').length;" "  const compter = (changements) => changements.length;" \
  "$HE1"
prouver "« Attendre le réseau » qui déconnecte quand même" web/public/plateforme/poste.js \
  "const n = document.getElementById('poste-non'); if (n) n.onclick = () => fin(false);" "const n = document.getElementById('poste-non'); if (n) n.onclick = () => fin(true);" \
  "$HE4"
prouver "l'écran qui ne réenregistre pas au retour du réseau" web/public/v10/app.js \
  "  window.__enregistrerMaintenant = () => save(true);" "  window.__enregistrerMaintenant = () => {};" \
  "$HE1"
prouver "le bandeau qui tait ce qui attend" web/public/plateforme/poste.js \
  "      : attend ? \`\${attendent(enAttente)}\${l ? \` \${l}\` : ''}\`" "      : false ? \`\${attendent(enAttente)}\${l ? \` \${l}\` : ''}\`" \
  "$HE1"

prouver "une session finie qui efface ce qui attendait le réseau" web/src/api.ts \
  "    jeton = j;
    ecrire('skanfact.jeton', j, sessionStorage);" "    jeton = j; effacerLePoste();
    ecrire('skanfact.jeton', j, sessionStorage);" \
  "$HE5"

# ── Brique 74 : tes appareils ; l'appareil retiré efface ce qu'il garde (docs/hors-ligne.md, H9) ──
AP1="la liste : les siens seulement, celui-ci marqué ; retiré, il le dit, et son jeton reçoit l'ordre d'effacer"
AW1="le bureau retire le portable perdu ; le portable, à sa reconnexion, efface ce qu'il gardait, et l'entrée le dit"
prouver "une session simplement fermée qui reçoit l'ordre d'effacer" base/migrations/0043_appareils_retires.sql \
  "where s.jeton_empreinte = p_jeton_empreinte and a.revoque_le is not null)" "where s.jeton_empreinte = p_jeton_empreinte)" \
  "$AP1"
prouver "l'appareil retiré jamais averti" serveur/app.ts \
  "          if (jeton && !cle && await jetonDUnAppareilRetire(ctx, jeton)) {" "          if (false) {" \
  "$AP1"
prouver "l'appareil où l'on est jamais marqué" serveur/routes/socle.ts \
  "celuiCi: a.id === qui.appareil" "celuiCi: false" \
  "$AP1"
prouver "un appareil retiré que la liste ne dit pas" serveur/routes/socle.ts \
  "retireLe: a.revoque_le ? a.revoque_le.toISOString() : null" "retireLe: null" \
  "$AP1"
prouver "l'appareil retiré qui garde ce qu'il gardait" $PONT \
  "      await poste.effacer();
    }
    location.replace('/');" "    }
    location.replace('/');" \
  "$AW1"
prouver "l'entrée qui tait que l'appareil est retiré" web/src/App.tsx \
  "        if (r.corps.effacer) toast(r.corps.motif ?? '', true);
" "" \
  "$AW1"
# Depuis le lot onboarding (0076), la liste vit dans compte.js, partagé avec le Cabinet.
prouver "retirer un appareil sans demander" web/public/plateforme/compte.js \
  "        if (!bouton.dataset.confirme) {
          bouton.dataset.confirme = '1';
          bouton.textContent = 'Oui, le retirer';" "        if (false) {
          bouton.dataset.confirme = '1';
          bouton.textContent = 'Oui, le retirer';" \
  "$AW1"
prouver "retirer l'appareil où l'on est" web/public/plateforme/compte.js \
  "\${a.celuiCi || a.retireLe ? '' :" "\${a.retireLe ? '' :" \
  "$AW1"
prouver "le nom d'un appareil illisible (la signature du navigateur)" web/src/ecrans/Connexion.tsx \
  "appareil: { nom: nomDeCetAppareil(), type: 'navigateur'" "appareil: { nom: navigator.userAgent.slice(0, 80) || 'Navigateur', type: 'navigateur'" \
  "$AW1"
prouver "le panneau « Tes appareils » absent des Paramètres" web/public/v10/app.js \
  "    if (bridge.dessinerAppareils && \$('#appareils-panel')) void bridge.dessinerAppareils(\$('#appareils-panel'));
" "" \
  "$AW1"

# ── Brique 74 bis : la quarantaine (docs/hors-ligne.md, H10) ──
AQ1="remis par l'appareil retiré, jamais appliqué d'office ; accepté, ce qui a changé depuis est mis de côté et dit"
AQ2="rejeter n'applique rien ; une session fermée avant le retrait, ou une entreprise d'un autre, ne remet rien"
AW2="le portable retiré remet ce qu'il avait fait hors ligne ; accepté, ce qui a changé depuis est mis de côté et dit"
Q=base/migrations/0044_quarantaine.sql
prouver "un jeton valable qui remet" $Q \
  "   where se.jeton_empreinte = p_jeton_empreinte and a.revoque_le is not null and se.fermee_le = a.revoque_le;" "   where se.jeton_empreinte = p_jeton_empreinte;" \
  "$AQ1"
prouver "une session fermée avant le retrait qui remet" $Q \
  " and se.fermee_le = a.revoque_le;" ";" \
  "$AQ2"
prouver "une remise dans l'entreprise d'un autre" $Q \
  "  if not exists (select 1 from socle.membre m where m.utilisateur = s.utilisateur and m.entreprise = p_entreprise) then return null; end if;
" "" \
  "$AQ2"
prouver "une remise renvoyée qui se double" $Q \
  "  unique (session, entreprise),
|||
    on conflict (session, entreprise) do nothing;" "|||;" \
  "$AQ1"
prouver "les réglages du dossier comptés comme des changements remis" $Q \
  " where e->>'collection' is distinct from '_racine'" "" \
  "$AQ1"
prouver "une remise réécrite après coup" $Q \
  "  raise exception 'une remise en quarantaine ne se modifie pas et ne s''efface pas' using errcode = '42501';" "  return new;" \
  "$AQ1"
prouver "une remise visible de tous" $Q \
  "create policy visible on socle.quarantaine using (entreprise in (select socle.mes_entreprises()));" "create policy visible on socle.quarantaine using (true);" \
  "$AQ2"
prouver "l'entrée qui tait ce que l'appareil a remis" serveur/app.ts \
  "            const remis = await remisParCeJeton(ctx, jeton);" "            const remis = 0;" \
  "$AQ1"
prouver "accepter qui écrase ce qui a changé depuis" serveur/v10/routes.ts \
  "            await appliquer(tx, params.entreprise ?? '', qui.utilisateur, [c]);" "            await appliquer(tx, params.entreprise ?? '', qui.utilisateur, [{ ...c, revision: ((l) => (l ? Number(l.revision) : null))((await tx.query('select revision from socle.dossier_v10 where entreprise = \$1 and collection = \$2 and cle = \$3', [params.entreprise, c.collection, c.cle])).rows[0]) }]);" \
  "$AQ1"
prouver "un changement refusé qui fait échouer toute la remise" serveur/v10/routes.ts \
  "            else if (e instanceof Refus || (e as { code?: unknown }).code === '42501') misDeCote.push({ collection: c.collection, cle: c.cle, raison: texteDuRefus(e as Error) });
" "" \
  "$AQ1"
prouver "un changement changé depuis qui fait échouer toute la remise" serveur/v10/routes.ts \
  "            await tx.query('rollback to savepoint changement');" "            throw e;" \
  "$AQ1"
prouver "rejeter qui applique quand même" serveur/v10/routes.ts \
  "      if (corps.accepter) {" "      if (true) {" \
  "$AQ2"
prouver "une remise décidée deux fois" serveur/v10/routes.ts \
  "      if (q.decision) return { statut: 409, corps: { motif: motif('quarantaine.deja_decidee') } };
" "" \
  "$AQ1"
prouver "l'appareil retiré qui efface sans remettre" $PONT \
  "      if ((await remettre()) === null) {" "      if (false) {" \
  "$AW2"
prouver "une remise ratée qui efface quand même" $PONT \
  "n\\'est effacé tant qu\\'il ne l\\'a pas reçu.');
        return;" "n\\'est effacé tant qu\\'il ne l\\'a pas reçu.');" \
  "$AW2"
prouver "un serveur qui trébuche pris pour une remise reçue" $PONT \
  "      if (r.status >= 500) return null;
" "" \
  "$AW2"
prouver "l'entrée qui efface avant que l'entreprise ne remette" web/src/api.ts \
  "    if (gardee && jeton) {" "    if (false) {" \
  "$AW2"
prouver "le bandeau qui tait les remises à décider" $PONT \
  "    poste.annoncer(\`\${qui} \${quoi} ta décision.\`, 'Voir', () => {" "    ((..._) => undefined)(\`\${qui} \${quoi} ta décision.\`, 'Voir', () => {" \
  "$AW2"
prouver "« Voir » qui ne mène nulle part" web/public/v10/app.js \
  "  window.__allerParametres = (tab, focus) => allerParametres(tab, focus);
" "" \
  "$AW2"
prouver "le panneau des remises jamais dessiné" web/public/v10/app.js \
  "    if (bridge.dessinerQuarantaine && \$('#quarantaine-panel')) bridge.dessinerQuarantaine(\$('#quarantaine-panel'));
" "" \
  "$AW2"
prouver "rejeter une remise sans demander" $PONT \
  "        if (!rej.dataset.confirme) {" "        if (false) {" \
  "$AW2"
prouver "accepté, ce qui est mis de côté passé sous silence" $PONT \
  "\${r.misDeCote.length ? \`<p>Mis de côté :</p>" "\${false ? \`<p>Mis de côté :</p>" \
  "$AW2"
prouver "un client ajouté dit modifié" $PONT \
  "c.revision === null ? 'ajouté' : 'modifié'" "'modifié'" \
  "$AW2"

# ── Brique 75 : les limites du hors-ligne (docs/hors-ligne.md, H11 et H12) ──
HP1="un navigateur qui ne promet pas de garder : sans réseau, on consulte, rien ne s'enregistre, et l'écran dit pourquoi"
HP2="plus de 72 heures sans le serveur : ce qui attendait partira, mais rien de neuf ne s'enregistre ; à 71 heures, si"
POSTE=web/public/plateforme/poste.js
prouver "un navigateur qui peut tout vider, et le poste qui enregistre quand même" $POSTE \
  "    if (persistant !== true) return PERSISTANT;
    let c = 0;
    try { c = Number(localStorage.getItem(CONTACT)) || 0; } catch { /* sans mémoire : pas de limite de durée */ }
    return c && Date.now() - c > DROITS_MS" "    let c = 0;
    try { c = Number(localStorage.getItem(CONTACT)) || 0; } catch { /* sans mémoire : pas de limite de durée */ }
    return c && Date.now() - c > DROITS_MS" \
  "$HP1"
prouver "l'application qui ne demande jamais à garder" $POSTE \
  "navigator.storage.persisted().then((p) => p || navigator.storage.persist())" "navigator.storage.persisted()" \
  "$HP2"
prouver "plus de 72 heures sans le serveur, et le poste qui enregistre quand même" $POSTE \
  "    return c && Date.now() - c > DROITS_MS ? DROITS : null;" "    return null;" \
  "$HP2"
prouver "72 heures comptées trop large" $POSTE \
  "  const DROITS_MS = 72 * 3600 * 1000;" "  const DROITS_MS = 73 * 3600 * 1000;" \
  "$HP2"
prouver "72 heures comptées trop court" $POSTE \
  "  const DROITS_MS = 72 * 3600 * 1000;" "  const DROITS_MS = 70 * 3600 * 1000;" \
  "$HP2"
prouver "le dernier contact jamais noté" $POSTE \
  "    if (serveur) try { localStorage.setItem(CONTACT, String(Date.now())); } catch { /* sans mémoire : pas de limite de durée */ }
" "" \
  "$HP2"
prouver "le réseau revenu sans le serveur pris pour un contact" $POSTE \
  "    if (serveur) try { localStorage.setItem(CONTACT, String(Date.now())); }" "    try { localStorage.setItem(CONTACT, String(Date.now())); }" \
  "$HP2"
prouver "le bandeau qui promet de garder ce qui peut disparaître" $POSTE \
  "        : l || 'Ce que tu enregistres se garde sur ce poste, et partira seul au retour du réseau.';" "        : 'Ce que tu enregistres se garde sur ce poste, et partira seul au retour du réseau.';" \
  "$HP1"
prouver "le bandeau qui tait la limite des 72 heures quand quelque chose attend" $POSTE \
  "      : attend ? \`\${attendent(enAttente)}\${l ? \` \${l}\` : ''}\`" "      : attend ? attendent(enAttente)" \
  "$HP2"
prouver "hors limite, l'enregistrement gardé quand même" $PONT \
  "  const gardableHorsLigne = (e) => !!(e && /** @type {any} */ (e).horsLigne) && poste.garde() && !poste.limite();" "  const gardableHorsLigne = (e) => !!(e && /** @type {any} */ (e).horsLigne) && poste.garde();" \
  "$HP1"
prouver "le refus hors limite qui ne dit pas pourquoi" $PONT \
  "    return l ? Object.assign(new Error(l), { horsLigne: true }) : e;" "    return e;" \
  "$HP1"

# ── Brique 76 : un membre retiré (docs/hors-ligne.md, H13) ──
AQ3="un membre retiré remet par sa session valable ; encore membre, ou jamais membre, rien n'est reçu"
MR1="le portable de Karim, retiré de l'équipe : ce qu'il avait fait est remis, la copie de l'épicerie s'efface, la sienne reste"
M45=base/migrations/0045_membre_retire.sql
prouver "une remise d'un membre encore actif" $M45 \
  " and m.entreprise = p_entreprise and not m.actif) then" " and m.entreprise = p_entreprise) then" \
  "$AQ3"
prouver "une remise dans une entreprise dont on n'a jamais été membre" $M45 \
  "  if not exists (select 1 from socle.membre m where m.utilisateur = s.utilisateur and m.entreprise = p_entreprise and not m.actif) then
    return null;
  end if;
" "" \
  "$AQ3"
prouver "le membre retiré jamais entendu" serveur/connexion.ts \
  "  if (retire !== null) return retire;" "  return retire;" \
  "$AQ3"
prouver "l'entreprise qui ne s'ouvre plus, et le poste qui garde sa copie" $PONT \
  "        if (/** @type {any} */ (e).statut === 404) return await plusOuverte();
" "" \
  "$MR1"
prouver "le membre retiré qui efface sans remettre" $PONT \
  "    if (recus === null) {" "    if (false) {" \
  "$MR1"
prouver "le souvenir d'une entreprise fermée gardé pour l'entrée" $POSTE \
  "    try { if (localStorage.getItem(DERNIERE) === id) localStorage.removeItem(DERNIERE); } catch { /* rien à retirer */ }
" "" \
  "$MR1"
prouver "la copie d'une entreprise fermée gardée" $POSTE \
  "    await faire('copies', 'readwrite', (s) => s.delete(id));
" "" \
  "$MR1"
prouver "ce qui attendait une entreprise fermée gardé" $POSTE \
  "    await faire('attentes', 'readwrite', (s) => s.delete(id));
" "" \
  "$MR1"
prouver "le bandeau qui tait ce qui a été remis" $PONT \
  "      : recus === 1 ? ', et ton changement fait hors ligne est remis à son propriétaire, qui décidera' : '';" "      : '';" \
  "$MR1"
prouver "le nombre remis jamais lu" $PONT \
  "      return typeof lu.recus === 'number' ? lu.recus : 0;" "      return 0;" \
  "$MR1"
prouver "« Continuer » qui ne mène nulle part" $POSTE \
  "    if (b) b.onclick = () => location.replace('/');
  }
  // Hors ligne, sans rien à montrer" "  }
  // Hors ligne, sans rien à montrer" \
  "$MR1"

# ── Brique 77 : l'espace client (docs/espace-client.md) ──
EC1="le lien d'une pièce et celui du compte : ses pièces émises seulement, ce qu'il en doit, rien de ce qui reste dans l'entreprise ; retiré, il ne s'ouvre plus"
EC2="une pièce réduite à ce qu'elle imprime s'imprime exactement comme la pièce entière"
EC3="le lien d'une facture, puis celui du compte : la pièce comme imprimée, ce qu'il doit, vu, puis retiré"
prouver "le brouillon montré au client" base/migrations/0047_paiement_en_ligne.sql \
  "where l.id = p_lien and p.statut = 'emise' and p.type in ('facture', 'avoir')" "where l.id = p_lien and p.type in ('facture', 'avoir')" \
  "$EC1"
prouver "les pièces du client d'à côté montrées" base/migrations/0047_paiement_en_ligne.sql \
  "join socle.tiers t on t.id = p.tiers and t.ref_v10 = l.client_v10" "join socle.tiers t on t.id = p.tiers" \
  "$EC1"
prouver "le lien d'une pièce qui montre tout le compte" base/migrations/0047_paiement_en_ligne.sql \
  "
     and (l.piece_v10 is null or p.ref_v10 = l.piece_v10)" "" \
  "$EC1"
prouver "le ticket de caisse montré au client" base/migrations/0047_paiement_en_ligne.sql \
  "
     and (d.contenu -> 'ticket') is distinct from 'true'::jsonb" "" \
  "$EC1"
prouver "un lien retiré qui s'ouvre encore" base/migrations/0047_paiement_en_ligne.sql \
  "where jeton_empreinte = p_jeton_empreinte and revoque_le is null
" "where jeton_empreinte = p_jeton_empreinte
" \
  "$EC1"
prouver "l'ouverture d'un lien jamais notée" base/migrations/0073_devis_par_son_lien.sql \
  "  update ventes.lien set vu_le = p_maintenant, vues = vues + 1 where id = l.id;
" "" \
  "$EC1"
prouver "les avoirs d'une facture oubliés par l'espace" base/migrations/0047_paiement_en_ligne.sql \
  "where a.entreprise = p.entreprise and a.corrige = p.id and a.statut = 'emise'" "where false" \
  "$EC1"
prouver "les règlements d'une facture oubliés par l'espace" base/migrations/0047_paiement_en_ligne.sql \
  "where r.entreprise = p.entreprise and r.piece = p.id" "where false" \
  "$EC1"
prouver "le prix de revient d'une ligne envoyé au client" serveur/ventes/espace.ts \
  "'unitPrice', 'vatRate', 'noDiscount'] as const;" "'unitPrice', 'vatRate', 'noDiscount', 'unitCost'] as const;" \
  "$EC1"
prouver "les paiements envoyés au client" serveur/ventes/espace.ts \
  "'withholdingRate', 'lines', 'ttn',
] as const;" "'withholdingRate', 'lines', 'ttn', 'payments',
] as const;" \
  "$EC1"
prouver "la fiche société entière envoyée au client" serveur/ventes/espace.ts \
  "export const nettoyerSociete = (societe: unknown) => garder(societe, CHAMPS_SOCIETE);" "export const nettoyerSociete = (societe: unknown) => societe as Objet;" \
  "$EC1"
prouver "la fiche client entière envoyée au client" serveur/ventes/espace.ts \
  "export const nettoyerClient = (client: unknown) => garder(client, CHAMPS_CLIENT);" "export const nettoyerClient = (client: unknown) => client as Objet;" \
  "$EC1"
prouver "une ligne envoyée entière au client" serveur/ventes/espace.ts \
  "  if (Array.isArray(d.lines)) d.lines = d.lines.map((l) => garder(l, CHAMPS_LIGNE));
" "" \
  "$EC1"
prouver "la référence d'une pièce oubliée par l'espace" serveur/ventes/espace.ts \
  "'subject', 'reference', 'notes'," "'subject', 'notes'," \
  "$EC2"
prouver "le régime de TVA figé oublié par l'espace" serveur/ventes/espace.ts \
  "'creditReason', 'regimeTva', 'exonerationRS'," "'creditReason', 'exonerationRS'," \
  "$EC2"
prouver "la fin de l'exonération oubliée par l'espace" serveur/ventes/espace.ts \
  "exonerationRS: ['numero', 'au']" "exonerationRS: ['numero']" \
  "$EC2"
prouver "une exonération figée à « aucune » changée en mention vide" serveur/ventes/espace.ts \
  "if (objet(d[cle])) d[cle] = garder(d[cle], champs);" "if (cle in d) d[cle] = garder(d[cle], champs);" \
  "$EC2"
prouver "un avoir compté dans ce que le client doit" serveur/ventes/espace.ts \
  "    if (p.type !== 'facture') continue;
" "" \
  "$EC1"
prouver "le reste d'une facture sans ses avoirs" serveur/ventes/espace.ts \
  "soldeFacture(net, p.avoirs.map(BigInt), p.reglements.map(BigInt)) : null;" "soldeFacture(net, [], p.reglements.map(BigInt)) : null;" \
  "$EC1"
prouver "un lien donné pour un client inconnu" serveur/ventes/routes.ts \
  "      if (!client) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
" "" \
  "$EC1"
prouver "un lien donné pour une pièce pas encore émise" serveur/ventes/routes.ts \
  "and t.ref_v10 = \$3 and p.statut = 'emise' and p.type in ('facture', 'avoir')" "and t.ref_v10 = \$3 and p.type in ('facture', 'avoir')" \
  "$EC1"
prouver "un lien donné pour la pièce d'un autre client" serveur/ventes/routes.ts \
  "and t.ref_v10 = \$3 and p.statut = 'emise'" "and \$3::text is not null and p.statut = 'emise'" \
  "$EC1"
prouver "un lien donné pour un ticket de caisse" serveur/ventes/routes.ts \
  "
            and (d.contenu -> 'ticket') is distinct from 'true'::jsonb" "" \
  "$EC1"
prouver "le jeton d'un lien gardé en clair" serveur/ventes/routes.ts \
  "empreinte(jeton), maintenant()" "jeton, maintenant()" \
  "$EC1"
prouver "retirer un lien qui ne le retire pas" serveur/ventes/routes.ts \
  "update ventes.lien set revoque_le = \$3, revoque_par = socle.moi()" "update ventes.lien set vu_le = \$3, revoque_par = revoque_par" \
  "$EC1"
prouver "la fenêtre qui sème un lien à chaque ouverture" web/public/plateforme/pont.js \
  "      \$r('#lc-compte').onclick = () => { void creer(true); };
" "      \$r('#lc-compte').onclick = () => { void creer(true); };
      void creer(false);
" \
  "$EC3"
prouver "« Vu le … » jamais dit à l'entreprise" web/public/plateforme/pont.js \
  ": l.vuLe ? " ": false ? " \
  "$EC3"
prouver "« Retirer » qui ne retire rien" web/public/plateforme/pont.js \
  "try { await appel('DELETE', \`/espace/liens/" "try { if (false) await appel('DELETE', \`/espace/liens/" \
  "$EC3"
prouver "le lien du compte qui donne celui de la pièce" web/public/plateforme/pont.js \
  "compte ? { client: doc.clientId } : { client: doc.clientId, piece: doc.id }" "{ client: doc.clientId, piece: doc.id }" \
  "$EC3"
prouver "« Lien pour le client… » absent d'une facture émise" web/public/v10/app.js \
  "&& !C.estTicket(doc) && bridge.lienClient ? '<button id=\"lien-client\">" "&& !C.estTicket(doc) && false ? '<button id=\"lien-client\">" \
  "$EC3"
prouver "les nombres exacts illisibles pour le client" web/public/espace/espace.js \
  "      if (cles.length === 1 && cles[0] === '~n') return Number(/** @type {any} */ (v)['~n']);
" "" \
  "$EC3"
prouver "le reste à payer tu au client" web/public/espace/espace.js \
  "Number(p.reste) > 0 ? " "false ? " \
  "$EC3"
prouver "« Tu dois » qui tait ce qui est dû" web/public/espace/espace.js \
  "const du = vue.totaux.filter((/** @type {any} */ t) => Number(t.du) > 0);" "const du = vue.totaux.filter(() => false);" \
  "$EC3"
prouver "le lien d'une pièce qui ouvre la liste" web/public/espace/espace.js \
  "    if (vue.lien === 'piece' && vue.pieces[0]) piece(vue.pieces[0], false);" "    if (false) piece(vue.pieces[0], false);" \
  "$EC3"
prouver "l'impression refusée par le navigateur" web/public/espace/espace.js \
  "f.setAttribute('sandbox', 'allow-same-origin allow-modals');" "f.setAttribute('sandbox', 'allow-same-origin');" \
  "$EC3"
prouver "sur un téléphone, des chiffres sans ce qu'ils sont" web/public/espace/espace.css \
  "  .etiquette { display: inline; color: var(--doux); }
" "" \
  "$EC3"
prouver "ce qu'une facture a déjà reçu jamais envoyé au client" serveur/ventes/espace.ts \
  "paye: solde ? m(solde.paye) : null, credite: solde ? m(solde.credite) : null," "paye: null, credite: null," \
  "$EC1"
prouver "ce qu'une facture a déjà reçu tu au client" web/public/espace/espace.js \
  "\${recu(p) ? \`<div class=\"recu\">\${recu(p)}</div>\` : ''}" "" \
  "$EC3"
prouver "les avoirs d'une facture tus dans le relevé" web/public/espace/espace.js \
  "    Number(p.credite) > 0 ? \`Avoirs : \${esc(montant(p.credite, p.devise))}\` : '',
" "" \
  "$EC3"

# ── Brique 78 : le paiement en ligne (docs/paiement-en-ligne.md) ──
PA1="le coffre : un scellé ne s'ouvre qu'avec sa clé, pour son entreprise, intact"
PA2="brancher Konnect : la clé scellée, jamais rendue ni lisible par le serveur ; le compte « Konnect » naît une fois"
PA3="payer le reste d'une facture : prouvé auprès de Konnect, enregistré une seule fois sur le compte « Konnect »"
PA4="un refus de Konnect se voit chez l'entreprise ; un « payé » d'un autre montant ne s'enregistre pas ; débranché, plus de paiement"
PA5="le filet : un paiement dont l'avis s'est perdu, et dont le client n'est pas revenu, s'enregistre quand même ; déjà payé, on ne repaie pas"
PW="Nadia branche Konnect ; son client paie sa facture en ligne ; le paiement arrive sur la facture"
prouver "deux clics, deux paiements" base/migrations/0047_paiement_en_ligne.sql \
  "  if v_ouvert is not null then return jsonb_build_object('id', v_ouvert, 'adresse', v_adresse); end if;
" "" \
  "$PA3"
prouver "une demande échouée redonnée" base/migrations/0047_paiement_en_ligne.sql \
  "where x.entreprise = v_entreprise and x.piece = v_piece and x.statut = 'initie' and x.montant = p_montant" "where x.entreprise = v_entreprise and x.piece = v_piece and x.montant = p_montant" \
  "$PA4"
prouver "une demande redonnée pour un autre montant" base/migrations/0047_paiement_en_ligne.sql \
  "and x.statut = 'initie' and x.montant = p_montant" "and x.statut = 'initie'" \
  "$PA4"
prouver "une demande de plus de 25 minutes redonnée" base/migrations/0047_paiement_en_ligne.sql \
  "and x.adresse is not null and x.cree_le > p_maintenant - interval '25 minutes'" "and x.adresse is not null" \
  "$PA5"
prouver "la demande ouverte chez Konnect jamais notée" base/migrations/0047_paiement_en_ligne.sql \
  "set ref = p_ref, adresse = p_adresse where id = p_id and statut = 'initie' and ref is null" "set ref = p_ref, adresse = p_adresse where id = p_id and false" \
  "$PA3"
prouver "le refus de Konnect tu à l'entreprise" base/migrations/0047_paiement_en_ligne.sql \
  "  update ventes.prestataire pr set dernier_refus = p_motif, dernier_refus_le = p_maintenant
    from ventes.paiement_en_ligne x where x.id = p_id and pr.entreprise = x.entreprise;
" "" \
  "$PA4"
prouver "la demande refusée par Konnect restée ouverte" base/migrations/0047_paiement_en_ligne.sql \
  "set statut = 'echoue', motif = p_motif where id = p_id and statut = 'initie';" "set motif = p_motif where id = p_id and statut = 'initie';" \
  "$PA4"
prouver "un « payé » faux qui reste ouvert" base/migrations/0047_paiement_en_ligne.sql \
  "  update ventes.paiement_en_ligne set statut = 'echoue', motif = p_motif where id = p_id and statut = 'initie'
\$\$" "  update ventes.paiement_en_ligne set motif = p_motif where id = p_id and statut = 'initie'
\$\$" \
  "$PA4"
prouver "le filet qui passe trop tôt" base/migrations/0047_paiement_en_ligne.sql \
  "and cree_le between p_maintenant - interval '1 day' and p_maintenant - interval '2 minutes'" "and cree_le between p_maintenant - interval '1 day' and p_maintenant" \
  "$PA5"
prouver "le filet qui ne passe jamais" base/migrations/0047_paiement_en_ligne.sql \
  "     where statut = 'initie' and ref is not null
" "     where false
" \
  "$PA5"
prouver "la clé scellée lisible par le compte du serveur" base/migrations/0047_paiement_en_ligne.sql \
  "grant select (entreprise, prestataire, portefeuille, cle_fin, compte_v10, pose_le, pose_par, dernier_refus, dernier_refus_le)
  on ventes.prestataire to skanfact_app;" "grant select on ventes.prestataire to skanfact_app;" \
  "$PA2"
prouver "l'espace qui tait le paiement en ligne" base/migrations/0073_devis_par_son_lien.sql \
  "'paiement', exists (select 1 from ventes.prestataire pr where pr.entreprise = l.entreprise)," "'paiement', false," \
  "$PA3"
prouver "« Payer en ligne » chez une entreprise qui ne l'accepte pas" serveur/ventes/espace.ts \
  " && devise === 'TND' && paiement;" " && devise === 'TND';" \
  "$PA3"
prouver "« Payer en ligne » proposé en devise" serveur/ventes/espace.ts \
  " && devise === 'TND' && paiement;" " && paiement;" \
  "$PA4"
prouver "le montant entier demandé au lieu du reste" serveur/v10/paiement.ts \
  "const reste = soldeFacture(BigInt(a.piece.net), a.piece.avoirs.map(BigInt), a.piece.reglements.map(BigInt)).reste;" "const reste = BigInt(a.piece.net);" \
  "$PA3"
prouver "une facture en devise payée en ligne" serveur/v10/paiement.ts \
  "  if (a.piece.devise !== 'TND') return { refus: motif('paiement.devise'), statut: 409 };
" "" \
  "$PA4"
prouver "une facture soldée payée encore" serveur/v10/paiement.ts \
  "  if (reste <= 0n) return { refus: motif('paiement.rien_a_payer'), statut: 409 };
" "" \
  "$PA3"
prouver "une demande déjà payée redonnée" serveur/v10/paiement.ts \
  "    if (e?.etat === 'encaisse') return { refus: motif('paiement.rien_a_payer'), statut: 409 };
" "" \
  "$PA5"
prouver "une demande refusée redonnée telle quelle" serveur/v10/paiement.ts \
  "    if (e?.etat === 'echoue') return demanderPaiement(ctx, jeton, numero);
" "" \
  "$PA4"
prouver "le paiement déjà enregistré qu'une vérification croisée tente encore (sa page dit « en cours »)" serveur/v10/paiement.ts \
  "        if (!x || x.statut !== 'initie') return;
" "" \
  "$PA5"
prouver "le paiement posé hors du compte Konnect" serveur/v10/paiement.ts \
  "accountId: v.compte_v10, note: ''," "accountId: '', note: ''," \
  "$PA3"
prouver "l'encaissement en ligne sans sa trace" serveur/v10/paiement.ts \
  "await tracer(tx, v.entreprise, 'ventes.paiement_en_ligne.encaisser'," "await tracer(tx, v.entreprise, 'ventes.autre'," \
  "$PA3"
prouver "un paiement en attente pris pour encaissé" serveur/ventes/konnect.ts \
  "  if (statut !== 'completed') return { etat: 'attente', statut };
" "" \
  "$PA3"
prouver "un « payé » d'une autre commande enregistré" serveur/ventes/konnect.ts \
  "  if (String(p.orderId ?? '') !== attendu.commande) return { etat: 'echoue', motif: t('paiement.konnect_autre_commande') };
" "" \
  "$PA4"
prouver "un « payé » d'un autre montant enregistré" serveur/ventes/konnect.ts \
  "  if (recu !== attendu.montant) return" "  if (false) return" \
  "$PA4"
prouver "la page de retour sans son secret" serveur/v10/paiement.ts \
  "  if (par.secret !== undefined && v.retour_empreinte !== empreinte(par.secret)) return null;
" "" \
  "$PA3"
prouver "une clé illisible qui part quand même chez Konnect" serveur/v10/paiement.ts \
  "  if (cle === null) {" "  if (false) {" \
  "$PA2"
prouver "la clé de Konnect gardée en clair" serveur/v10/routes.ts \
  "sceller(ctx.paiement.coffre, ent, corps.cle)" "corps.cle" \
  "$PA2"
prouver "un compte Konnect de plus à chaque branchement" serveur/v10/routes.ts \
  "      let compte = existe ? String(deja) : '';" "      let compte = '';" \
  "$PA2"
prouver "l'avis de Konnect qui ne déclenche rien" serveur/v10/routes.ts \
  "        if (ref) await verifierPaiement(ctx, { ref });
" "" \
  "$PA4"
prouver "un scellé ouvert pour une autre entreprise" serveur/coffre.ts \
  "  c.setAAD(Buffer.from(lie, 'utf8'));
|||  d.setAAD(Buffer.from(lie, 'utf8'));
" "|||" \
  "$PA1"
prouver "la clé ramassée par les Paramètres de la v10" web/public/plateforme/pont.js \
  "<input data-champ=\"cle\" type=\"password\"" "<input data-champ=\"cle\" name=\"cle\" type=\"password\"" \
  "$PW"
prouver "la frappe de la clé qui propose d'enregistrer les Paramètres" web/public/plateforme/pont.js \
  "    for (const t of ['input', 'change']) el.addEventListener(t, (ev) => ev.stopPropagation());
    const form = /** @type {HTMLElement} */ (el.querySelector('#pl-form'));" "    const form = /** @type {HTMLElement} */ (el.querySelector('#pl-form'));" \
  "$PW"
prouver "le champ de la clé vide qui ne se montre pas" web/public/plateforme/pont.js \
  "portefeuille Konnect.'); champ(vide).focus(); return; }" "portefeuille Konnect.'); return; }" \
  "$PW"
prouver "arrêter le paiement en ligne sans demander" web/public/plateforme/pont.js \
  "      if (!arreter.dataset.confirme) {" "      if (false) {" \
  "$PW"
prouver "« Payer en ligne » absent de la facture" web/public/espace/espace.js \
  "\${p.payable ? \`<button type=\"button\" class=\"principal\" id=\"payer\">" "\${false ? \`<button type=\"button\" class=\"principal\" id=\"payer\">" \
  "$PW"
prouver "« Pour payer en ligne, ouvre la facture » jamais dit" web/public/espace/espace.js \
  "\${vue.pieces.some((/** @type {any} */ p) => p.payable) ? '<p class=\"aide\">" "\${false ? '<p class=\"aide\">" \
  "$PW"
prouver "le lien de l'espace oublié au retour" web/public/espace/espace.js \
  "    try { sessionStorage.setItem('skanfact.espace', jeton); } catch { /* la page de retour proposera de la fermer */ }
" "" \
  "$PW"
prouver "« Paiement reçu » jamais dit" web/public/espace/retour.js \
  "if (lu.etat === 'encaisse') { dire('Paiement reçu'" "if (lu.etat === 'jamais') { dire('Paiement reçu'" \
  "$PW"
prouver "le panneau « Paiement en ligne » jamais dessiné" web/public/v10/app.js \
  "    if (bridge.dessinerPaiement && \$('#paiement-panel')) void bridge.dessinerPaiement(\$('#paiement-panel'));
" "" \
  "$PW"
prouver "le mode « Paiement en ligne » inconnu de la v10" web/public/v10/core.js \
  "['en_ligne', 'Paiement en ligne'], " "" \
  "$PW"
prouver "la production qui démarre avec la clé d'essai du coffre" serveur/principal.ts \
  "  if (environnement === 'production' && !env.SKANFACT_COFFRE) throw" "  if (Date.now() < 0) throw" \
  "une configuration fausse l'arrête"
prouver "une étiquette du coffre tronquée qui passe" serveur/coffre.ts \
  ", { authTagLength: 16 });" ");" \
  "$PA1"
prouver "une clé du coffre qui n'a pas ses 32 octets" serveur/coffre.ts \
  "  if (cle.length !== 32) throw new CoffreFaux('coffre.cle_32_octets');
" "" \
  "une configuration fausse l'arrête"

# ── Brique 79 : les envois portent le lien de la pièce (docs/espace-client.md, E7) ──
EN1="le lien qu'un envoi porte : il dit par où il part, et ne promet le paiement en ligne qu'à une facture qui se paie en ligne"
EN2="la facture part avec son lien, par e-mail puis par WhatsApp ; le devis aussi ; le relevé part sans rien de joint"
prouver "le canal d'un lien jamais noté" serveur/ventes/routes.ts \
  "maintenant(), corps.canal ?? null])).rows[0].id);" "maintenant(), null])).rows[0].id);" \
  "$EN1"
prouver "« régler en ligne » promis sans paiement en ligne branché" serveur/ventes/routes.ts \
  "payable = payableEnLigne(piece.type, piece.devise, reste, paiement);" "payable = payableEnLigne(piece.type, piece.devise, reste, true);" \
  "$EN1"
prouver "« régler en ligne » promis pour une facture réglée" serveur/ventes/routes.ts \
  "(await soldesDeFactures(tx, ent, [{ id: piece.id, net }])).get(piece.id)?.reste ?? null" "net" \
  "$EN1"
prouver "l'e-mail d'une facture émise parti sans son lien" web/public/v10/app.js \
  "const corps = lien && v.lien ? await bridge.ajouterLien(doc, 'email'" "const corps = false ? await bridge.ajouterLien(doc, 'email'" \
  "$EN2"
prouver "le WhatsApp d'une facture émise parti sans son lien" web/public/v10/app.js \
  "const corps = lien && v.lien ? await bridge.ajouterLien(doc, 'whatsapp'" "const corps = false ? await bridge.ajouterLien(doc, 'whatsapp'" \
  "$EN2"
prouver "« Veuillez trouver ci-joint » laissé dans un message sans pièce jointe" web/public/plateforme/pont.js \
  ".replace(/Veuillez trouver ci-joint /g, 'Voici ')" "" \
  "$EN2"
prouver "le lien posé après la signature" web/public/plateforme/pont.js \
  "      return i > 0 ? \`\${t.slice(0, i)}\\n\\n\${phrase}\${t.slice(i)}\` : \`\${t}\\n\\n\${phrase}\`;" "      return \`\${t}\\n\\n\${phrase}\`;" \
  "$EN2"
prouver "« régler en ligne » promis sans que le serveur le dise" web/public/plateforme/pont.js \
  "r.payable ? \`Pour voir \${piece} et la régler en ligne\`" "true ? \`Pour voir \${piece} et la régler en ligne\`" \
  "$EN2"
prouver "la case du lien décochée qui ne rend pas la phrase du modèle" web/public/plateforme/pont.js \
  "      if (!c.checked && ta.value === avec) ta.value = sans;" "      if (false) ta.value = sans;" \
  "$EN2"
prouver "WhatsApp ouvert après l'attente du serveur (hors du geste)" web/public/plateforme/pont.js \
  "    if (canal === 'whatsapp') fenetreWhatsApp = window.open('', '_blank');
" "" \
  "$EN2"
prouver "WhatsApp dit « bloqué » d'une fenêtre ouverte (noopener)" web/public/plateforme/pont.js \
  ": window.open('', '_blank');
      if (!w) throw" ": window.open('', '_blank', 'noopener');
      if (!w) throw" \
  "$EN2"
prouver "« Lien pour le client… » tait par où le lien est parti" web/public/plateforme/pont.js \
  "\${CANAUX[l.canal] || 'donné'} le" "donné le" \
  "$EN2"
prouver "la question « Mail ou une autre messagerie » posée dans un navigateur" web/public/v10/app.js \
  "    if (bridge.ajouterLien) return 'mailto';
" "" \
  "$EN2"
prouver "Paramètres → Envois propose encore de choisir sa messagerie" web/public/v10/app.js \
  "\${panneau('p-envoi')}<p class=\"small muted\" id=\"mail-fixe\">" "\${panneau('p-envoi')}<select name=\"mailClient\"></select><p class=\"small muted\" id=\"mail-fixe\">" \
  "$EN2"
prouver "le relevé dit joint alors qu'un navigateur ne joint rien" web/public/v10/app.js \
  "close(); toast(att ? messageOuvert(rm, 'le relevé')" "close(); toast(true ? messageOuvert(rm, 'le relevé')" \
  "$EN2"

# ── Brique 80 : la facture électronique, le fichier TEIF écrit par le serveur (docs/facture-electronique.md) ──
EF1="à l'émission, le fichier TEIF est écrit, passe le schéma, dit les montants scellés, et ne se réécrit jamais"
EF2="soumise, une pièce dont le fichier serait refusé ne s'émet pas : c'est dit avant le numéro"
EF3="non soumise, la pièce s'émet quand même ; elle n'a pas de fichier du serveur"
EFW="soumise, Nadia voit avant le numéro ce qui empêcherait le fichier ; complétée, la facture s'émet et son fichier se télécharge"
prouver "le fichier El Fatoora jamais écrit à l'émission" serveur/v10/dossier.ts \
  "    if (f.ok) {" "    if (false) {" \
  "$EF1"
prouver "une entreprise soumise qui émet une pièce au fichier refusé" serveur/v10/dossier.ts \
  "  if (societe.efacture === true && !doc.ticket && !retour) {" "  if (false) {" \
  "$EF2"
prouver "une entreprise non soumise empêchée d'émettre" serveur/v10/dossier.ts \
  "  if (societe.efacture === true && !doc.ticket && !retour) {" "  if (!doc.ticket && !retour) {" \
  "$EF3"
prouver "un fichier El Fatoora aux montants faux gardé" serveur/v10/teif.ts \
  "    if (fichier !== serveur) return { code, fichier: fichier ?? '—', serveur };
" "" \
  "$EF1"
prouver "le fichier El Fatoora réécrit ou effacé par le compte du serveur" base/migrations/0049_efacture.sql \
  "grant select, insert on ventes.efacture to skanfact_app;" "grant select, insert, update, delete on ventes.efacture to skanfact_app;" \
  "$EF1"
prouver "l'avoir écrit sans la date de la facture qu'il corrige" serveur/v10/dossier.ts \
  "societe, origine ? commeLaV10(origine) as Json : null);" "societe, null);" \
  "$EF1"
prouver "un nombre du dossier lu comme un objet par le fichier" serveur/v10/teif.ts \
  "    if (cles.length === 1 && cles[0] === '~n') return Number((v as { '~n': string })['~n']);
" "" \
  "$EF1"
prouver "« Émettre » d'une entreprise soumise sans le contrôle avant la confirmation" web/public/v10/app.js \
  "        if (!validate()) return;
        if (bloqueParEfacture(doc)) return;
" "        if (!validate()) return;
" \
  "$EFW"
prouver "« Fichier pour El Fatoora » refait par l'écran au lieu du fichier du serveur" web/public/v10/app.js \
  "    const r = duServeur ? {" "    const r = false ? {" \
  "$EFW"
prouver "la fenêtre dit « enregistré » d'un fichier téléchargé" web/public/v10/app.js \
  "est \${bridge.teifDuServeur ? 'dans tes Téléchargements' : 'enregistré'}" "est \${false ? 'dans tes Téléchargements' : 'enregistré'}" \
  "$EFW"
prouver "« Montrer le fichier » proposé dans un navigateur" web/public/v10/app.js \
  "\${bridge.teifDuServeur ? '' : '<button class=\"btn\" id=\"teif-montrer\">" "\${false ? '' : '<button class=\"btn\" id=\"teif-montrer\">" \
  "$EFW"
prouver "le réglage « soumise à la facture électronique » jamais dessiné" web/public/v10/app.js \
  "\${bridge.teifDuServeur ? \`\${panneau('p-efacture'" "\${false ? \`\${panneau('p-efacture'" \
  "$EFW"

# ── Brique 81 : la signature DigiGo (docs/facture-electronique.md) ──
SG1="le signataire désigné reçoit un code ; le bon code signe les fichiers du serveur, qui se gardent tels quels"
SG2="trois codes faux perdent la demande ; un fichier rendu autre n'est pas gardé ; sans DigiGo, rien ne se signe"
SGW="Nadia désigne le signataire depuis le refus, puis signe la facture avec le code reçu ; le fichier signé se télécharge"
prouver "une signature demandée sans signataire désigné" serveur/v10/signature.ts \
  "  if (!s) throw new Refus('efacture.sans_signataire', { bouton: 'efacture.signataire' });
" "" \
  "$SG1"
prouver "« Personne n'est désigné » sans le bouton qui mène au réglage" serveur/v10/signature.ts \
  "new Refus('efacture.sans_signataire', { bouton: 'efacture.signataire' })" "new Refus('efacture.sans_signataire')" \
  "$SG1"
prouver "une pièce sans fichier du serveur envoyée à la signature" serveur/v10/signature.ts \
  "    if (!p?.fichier) throw new Refus('efacture.sans_fichier', { valeurs: { numero: p?.numero_texte ?? cle } });
" "" \
  "$SG2"
prouver "une pièce signée deux fois" serveur/v10/signature.ts \
  "    if (p.signee) throw new Refus('efacture.deja_signee', { valeurs: { numero: p.numero_texte } });
" "" \
  "$SG1"
prouver "un quatrième code essayé" serveur/v10/signature.ts \
  "const ESSAIS = 3;" "const ESSAIS = 4;" \
  "$SG2"
prouver "trois codes faux, et la demande signe encore" serveur/v10/signature.ts \
  "perdue ? 'echouee' : 'code_envoye']" "'code_envoye']" \
  "$SG2"
prouver "trois codes faux sans le bouton qui recommence" serveur/v10/signature.ts \
  "{ motif: motif('efacture.code_epuise'), bouton: 'efacture.recommencer' }" "{ motif: motif('efacture.code_epuise'), bouton: null }" \
  "$SG2"
prouver "un fichier rendu autre par DigiGo gardé" serveur/v10/signature.ts \
  "    if (!signatureEnveloppe(f.xml, s.valeur)) return echec(motif('efacture.signature_fausse'));
" "" \
  "$SG2"
prouver "une demande à moitié signée gardée (le fichier faux sauté)" serveur/v10/signature.ts \
  "if (!signatureEnveloppe(f.xml, s.valeur)) return echec(motif('efacture.signature_fausse'));" "if (!signatureEnveloppe(f.xml, s.valeur)) continue;" \
  "$SG2"
prouver "un fichier rendu SANS signature pris pour signé" serveur/v10/digigo.ts \
  "return signatures.length === 1 && signe.replace(" "return signe.replace(" \
  "$SG1"
prouver "« Fichier pour El Fatoora » donne le fichier non signé d'une pièce signée" serveur/v10/routes.ts \
  "coalesce(x.xml_valide, g.xml, e.xml) xml" "coalesce(x.xml_valide, e.xml) xml" \
  "$SG1"
prouver "le fichier signé réécrit ou effacé par le compte du serveur" base/migrations/0050_signature.sql \
  "grant select, insert on ventes.efacture_signee to skanfact_app;" "grant select, insert, update, delete on ventes.efacture_signee to skanfact_app;" \
  "$SG1"
prouver "une signature sans trace de qui l'a faite" serveur/v10/signature.ts \
  "    await tracer(tx, entreprise, 'ventes.facture.signer', { type: 'piece', id: f.piece }, null, { demande: d.id, numero: f.numero, titulaire: d.titulaire });
" "" \
  "$SG1"
prouver "le refus « Personne n'est désigné » sans son bouton, à l'écran" web/public/plateforme/pont.js \
  "      /** @type {any} */ (e).bouton = typeof lu.bouton === 'string' ? lu.bouton : null;
" "" \
  "$SGW"
prouver "taper le signataire propose d'enregistrer les Paramètres" web/public/plateforme/pont.js \
  "    for (const t of ['input', 'change']) el.addEventListener(t, (ev) => ev.stopPropagation());
    const champ = /** @type {HTMLInputElement} */ (el.querySelector('[data-champ=identifiant]'));" "    const champ = /** @type {HTMLInputElement} */ (el.querySelector('[data-champ=identifiant]'));" \
  "$SGW"
prouver "le bouton « Désigner le signataire » laisse chercher la case" web/public/plateforme/pont.js \
  "    if (amenerSignataire) { amenerSignataire = false; if (!s) champ.focus({ preventScroll: true }); }
" "" \
  "$SGW"
prouver "après un code faux, le curseur n'est plus dans la case du code" web/public/plateforme/pont.js \
  "            else { champ.focus(); champ.select(); }
" "" \
  "$SGW"
prouver "« Signer (DigiGo)… » absent du menu d'une pièce émise" web/public/v10/app.js \
  "&& bridge.signerPiece ? \`<div class=\"ml-ligne\"><button id=\"signer\">" "&& false ? \`<div class=\"ml-ligne\"><button id=\"signer\">" \
  "$SGW"
prouver "le panneau « Qui signe » jamais dessiné" web/public/v10/app.js \
  "    if (bridge.dessinerSignataire && \$('#signataire-panel')) void bridge.dessinerSignataire(\$('#signataire-panel'));
" "" \
  "$SGW"
prouver "la fenêtre du fichier signé dit qu'il reste deux gestes" web/public/v10/app.js \
  "\${duServeur && duServeur.signe ? \`Il est signé" "\${false ? \`Il est signé" \
  "$SGW"
prouver "la fenêtre du fichier signé demande encore de le signer" web/public/v10/app.js \
  "\${duServeur && duServeur.signe && bridge.ttnDansLaFenetre ? '<div id=\"teif-ttn\"></div>'" "\${false ? '<div id=\"teif-ttn\"></div>'" \
  "$SGW"
prouver "une session refusée par DigiGo qui garde la demande ouverte" serveur/v10/signature.ts \
  "    if (a.statut !== 401) return echec(a.motif);
" "    if (a.statut !== 401) return { statut: 502, corps: { motif: phrase(a.motif), bouton: null } };
" \
  "$SG2"
prouver "la fenêtre d'une pièce signée qui propose encore d'envoyer un code" web/public/plateforme/pont.js \
  "        if (f && f.signe) fini(" "        if (false) fini(" \
  "$SGW"
# ── Brique 82 : l'envoi à la TTN (docs/facture-electronique.md) ──
TT1="une pièce signée part d'elle-même, une seule fois ; acceptée, sa référence, son code QR et la facture validée se gardent"
TT2="jamais deux dépôts : ni quand la réponse se perd, ni quand deux tours se croisent ; une panne se réessaie plus tard"
TT3="un refus se dit, et la pièce se renvoie ; un compte refusé se dit à l'entreprise ; une entreprise d'essai n'envoie rien"
TTW="la pièce signée attend le compte El Fatoora ; Nadia le pose depuis la fenêtre ; acceptée, la facture validée se télécharge, et la pièce imprimée porte sa référence et son code QR, jusque dans l'espace client"
prouver "une pièce signée qui ne part pas d'elle-même" serveur/v10/signature.ts \
  "  await mettreEnRoute(tx, entreprise, utilisateur, faits.map((f) => f.piece), maintenant);
" "" \
  "$TT1"
prouver "une entreprise d'essai qui envoie à la TTN" serveur/v10/envoi.ts \
  "  if (!e || e.essai) return;" "  if (!e) return;" \
  "$TT3"
prouver "un dépôt refait sans voir que la TTN a déjà la pièce" serveur/v10/envoi.ts \
  "  if (vu.valeur) return verdict(vu.valeur, e);" "  if (vu.valeur && e.statut === 'deposee') return verdict(vu.valeur, e);" \
  "$TT2"
prouver "deux tours du facteur qui déposent la même pièce" serveur/v10/envoi.ts \
  "and prochain_essai <= \$3 and (bail is null or bail < \$3) returning statut, essais" "and prochain_essai <= \$3 returning statut, essais" \
  "$TT2"
prouver "une panne réessayée aussitôt, sans attendre" serveur/v10/envoi.ts \
  "essais: e.essais + 1, apres: attente(e.essais) });" "essais: e.essais + 1, apres: 0 });" \
  "$TT2"
prouver "des pannes réessayées toujours au même rythme" serveur/v10/envoi.ts \
  "const ATTENTES = [1, 5, 15, 60];" "const ATTENTES = [1, 1, 1, 1];" \
  "$TT2"
prouver "« Fichier pour El Fatoora » donne le fichier signé d'une pièce acceptée par la TTN" serveur/v10/routes.ts \
  "coalesce(x.xml_valide, g.xml, e.xml) xml" "coalesce(g.xml, e.xml) xml" \
  "$TT1"
prouver "une pièce acceptée par la TTN qui change encore" base/migrations/0051_envoi_ttn.sql \
  "  if old.statut = 'acceptee' then perform socle.refus('une pièce acceptée par la TTN ne change plus'); end if;
" "" \
  "$TT1"
prouver "le mot de passe El Fatoora lisible par le compte du serveur" base/migrations/0051_envoi_ttn.sql \
  "grant select (entreprise, identifiant, pose_le, pose_par, dernier_refus, dernier_refus_le) on ventes.ttn_compte to skanfact_app;" "grant select on ventes.ttn_compte to skanfact_app;" \
  "$TT1"
prouver "un refus au dépôt pris pour une panne" serveur/v10/envoi.ts \
  "  if (!r.ok) return r.panne ? panne(r.motif) : { quoi: 'refusee', motif: t('ttn.depot_refuse', { message: r.message }) };" "  if (!r.ok) return panne(r.panne ? r.motif : t('ttn.injoignable'));" \
  "$TT3"
prouver "un refus au traitement pris pour une pièce encore en cours" serveur/v10/envoi.ts \
  "  if (depot.accuses.length) return {" "  if (false) return {" \
  "$TT3"
prouver "un compte refusé par la TTN qui ne se dit pas à l'entreprise" serveur/v10/envoi.ts \
  "      if (issue.compteRefuse) {" "      if (false) {" \
  "$TT3"
prouver "le compte posé, les pièces retenues attendent encore une heure" serveur/v10/envoi.ts \
  "update ventes.envoi_ttn set prochain_essai = \$2, essais = 0," "update ventes.envoi_ttn set prochain_essai = greatest(prochain_essai, \$2), essais = 0," \
  "$TT1"
prouver "le compte posé, les pièces se disent encore retenues par lui" serveur/v10/envoi.ts \
  "motif = case when motif ->> 'cle' in ('ttn.sans_compte', 'ttn.compte_refuse', 'ttn.compte_illisible') then null else motif end" "motif = motif" \
  "$TT1"
prouver "le renvoi d'une pièce que la TTN n'a pas refusée" serveur/v10/envoi.ts \
  "  if (x.statut !== 'refusee') throw new Refus('ttn.renvoi_impossible', { valeurs: { numero: x.numero_texte } });
" "" \
  "$TT1"
prouver "le fichier non signé déposé à la TTN" serveur/v10/envoi.ts \
  "select g.xml, p.numero_texte from ventes.efacture_signee g join ventes.piece p on p.id = g.piece where g.piece = \$1" "select g.xml, p.numero_texte from ventes.efacture g join ventes.piece p on p.id = g.piece where g.piece = \$1" \
  "$TT1"
prouver "la TTN interrogée avec le matricule du client" serveur/v10/envoi.ts \
  "matricule: champ(e.xml, 'MessageSenderIdentifier')" "matricule: champ(e.xml, 'MessageRecieverIdentifier')" \
  "$TT1"
prouver "la fenêtre d'une pièce retenue sans le bouton qui mène au compte" web/public/plateforme/pont.js \
  "\${compte ? '<div class=\"inline\"><button type=\"button\" class=\"btn btn-primary\" id=\"ttn-vers-compte\">" "\${false ? '<div class=\"inline\"><button type=\"button\" class=\"btn btn-primary\" id=\"ttn-vers-compte\">" \
  "$TTW"
prouver "« Brancher le compte El Fatoora » laisse chercher la case" web/public/plateforme/pont.js \
  "    if (amenerTtn) { amenerTtn = false; if (!form.hidden) champ(c ? 'motDePasse' : 'identifiant').focus({ preventScroll: true }); }
" "" \
  "$TTW"
prouver "taper le compte El Fatoora propose d'enregistrer les Paramètres" web/public/plateforme/pont.js \
  "    for (const t of ['input', 'change']) el.addEventListener(t, (ev) => ev.stopPropagation());
    const form = /** @type {HTMLElement} */ (el.querySelector('#ttn-form'));" "    const form = /** @type {HTMLElement} */ (el.querySelector('#ttn-form'));" \
  "$TTW"
prouver "le panneau du compte El Fatoora jamais dessiné" web/public/v10/app.js \
  "    if (bridge.dessinerTtn && \$('#ttn-panel')) void bridge.dessinerTtn(\$('#ttn-panel'));
" "" \
  "$TTW"
prouver "la fenêtre du fichier qui tait où en est l'envoi à la TTN" web/public/v10/app.js \
  "        if (bridge.ttnDansLaFenetre && \$('#teif-ttn', root)) bridge.ttnDansLaFenetre(\$('#teif-ttn', root), doc, duServeur, close);
" "" \
  "$TTW"

# ── Brique 83 : la référence de la TTN et son code QR sur la pièce imprimée (docs/facture-electronique.md) ──
QRE="une pièce réduite à ce qu'elle imprime s'imprime exactement comme la pièce entière"
QRT="le dessin des codes QR est celui du paquet épinglé, octet pour octet"
prouver "une référence de la TTN inventée depuis un écran" serveur/v10/dossier.ts \
  "  if (!serveur && apres && canonique(avant?.ttn) !== canonique(apres.ttn)) {" "  if (false) {" \
  "$TT1"
prouver "la pièce acceptée par la TTN sans sa référence au dossier" serveur/v10/envoi.ts \
  "      await poserLaReference(tx, d, issue.depot, maintenant);
" "" \
  "$TT1"
prouver "la référence de la TTN refusée au serveur lui-même" serveur/v10/envoi.ts \
  "le: maintenant.toISOString() } } }], { serveur: true });" "le: maintenant.toISOString() } } }]);" \
  "$TT1"
prouver "la pièce imprimée sans la référence de la TTN" web/public/v10/core.js \
  "\${doc.ttn && doc.ttn.reference ? \`<div class=\"info ttn\">" "\${false ? \`<div class=\"info ttn\">" \
  "$TTW"
prouver "le code QR de la TTN jamais dessiné sur la pièce" web/public/v10/core.js \
  "\${doc.ttn.qr && typeof api.qrImage === 'function' ? api.qrImage(doc.ttn.qr) : ''}" "\${''}" \
  "$TTW"
prouver "le dessin des QR branché nulle part dans l'application" web/public/plateforme/pont.js \
  "      if (qr) qr.brancher();
" "" \
  "$TTW"
prouver "« Recharger » jamais proposé après une acceptation pendant que la page était ouverte" web/public/plateforme/pont.js \
  "\${doc.ttn ? '' : '<p class=\"small\" id=\"ttn-recharger\">" "\${true ? '' : '<p class=\"small\" id=\"ttn-recharger\">" \
  "$TTW"
prouver "la référence de la TTN qui ne part pas dans l'espace client" serveur/ventes/espace.ts \
  "'withholdingRate', 'lines', 'ttn'," "'withholdingRate', 'lines'," \
  "$QRE"
prouver "le contenu du code QR qui ne part pas dans l'espace client" serveur/ventes/espace.ts \
  "ttn: ['reference', 'qr'] }" "ttn: ['reference'] }" \
  "$QRE"
prouver "le code du dessin des QR retouché à la main" web/public/tiers/qrcode.js \
  "var qrcode = function() {" "var qrcode = function() { // retouché" \
  "$QRT"

# ── Brique 84 : lire une facture d'achat en photo ou en PDF, sur nos serveurs (docs/achats.md) ──
LF2="la même, photographiée (penchée, floue)"
LF3="un fournisseur de matériaux : les traits du tableau"
LF4="un bureau d'études : des prestations sans quantité"
LF5="un fournisseur étranger : des euros (deux décimales)"
LR1="notre matricule n'est jamais pris pour celui du fournisseur, même lu le premier"
LR2="un total qui ne tombe pas se dit, avec les deux chiffres"
LR3="une TVA qui ne fait pas son taux sur sa base se dit"
LR4="des lignes illisibles : une ligne par taux, depuis les bases lues"
LR5="une ligne sans taux lisible ne reçoit aucun taux"
LR6="les étiquettes au-dessus de leurs valeurs"
LR7="une pièce adressée à un autre que nous se dit"
LR8="le FODEC compte dans le total recompté"
LR9="un texte qui n'est pas une facture : presque rien"
LS1="une photo se lit : la proposition, où chaque champ a été lu"
LS2="un PDF écrit par un logiciel se lit tel quel"
LSA="l'acheteur, c'est la fiche de l'entreprise"
LS3="ce qui n'est ni une photo ni un PDF, ou trop lourd, se refuse sans rien lire"
LS4="un serveur sans moteur le dit ; au-delà de sa file"
LS5="seuls ceux qui préparent un achat lisent"
LB2="il sait dire non : deux lectures fausses sur six"
LV1="un taux non lu n'est pas une TVA à 0 %"
LW1="Nadia photographie la facture : la fenêtre montre ce qui a été lu"
LW2="un fichier qui n'est pas une facture se refuse avec la phrase du serveur"
RV="les pages du quotidien de la v10, sur un téléphone et un ordinateur"
prouver "notre matricule pris pour celui du fournisseur" serveur/achats/lecture-facture.ts \
  "  const duFournisseur = matricules.find((m) => m.compact !== nous) ?? null;" "  const duFournisseur = matricules[0] ?? null;" \
  "$LR1"
prouver "un total qui ne tombe pas, dit juste" serveur/achats/lecture-facture.ts \
  "  const juste = recompte !== null && totalLu !== null ? recompte === totalLu : null;" "  const juste = recompte !== null && totalLu !== null ? true : null;" \
  "$LR2"
prouver "le total de la pièce « corrigé » par le recomptage" serveur/achats/lecture-facture.ts \
  "      totalTTC: totalLu !== null ? versTexte(totalLu, 3) : null," "      totalTTC: recompte !== null ? versTexte(recompte, 3) : totalLu !== null ? versTexte(totalLu, 3) : null," \
  "$LR2"
prouver "une TVA qui ne fait pas son taux, tue" serveur/achats/lecture-facture.ts \
  "    if (ecart(attendu, x.montant) > 2n) {" "    if (false) {" \
  "$LR3"
prouver "un taux inventé quand la TVA ne tombe pas juste" serveur/achats/lecture-facture.ts \
  "    if (ecart((totalHT * taux + 50n) / 100n, tvaLue) <= 2n) {" "    if (true) {" \
  "$LR4"
prouver "aucune ligne par taux quand le détail ne se lit pas" serveur/achats/lecture-facture.ts \
  "  } else if (bases.length && (totalHT === null || sommeBases === null || ecart(sommeBases, totalHT) <= 2n)) {" "  } else if (false) {" \
  "$LR4"
prouver "un taux supposé à une ligne qui n'en imprime pas" serveur/achats/lecture-facture.ts \
  "unSeulTaux !== null ? tauxEnTexte(unSeulTaux) : null, ht: r.total," "unSeulTaux !== null ? tauxEnTexte(unSeulTaux) : '19', ht: r.total," \
  "$LR5"
prouver "une répartition des taux ambiguë proposée quand même" serveur/achats/lecture-facture.ts \
  "  const seule = trouvees.length === 1 ? trouvees[0] : undefined;" "  const seule = trouvees[0];" \
  "$LR5"
prouver "les taux perdus jamais retrouvés par les bases lues" serveur/achats/lecture-facture.ts \
  "  if (rangeesJustes && bases.length > 1) repartir(rangees, bases);" "" \
  "$LF2"
prouver "une quantité perdue jamais retrouvée" serveur/achats/lecture-facture.ts \
  "        for (const deduite of [false, true]) {" "        for (const deduite of [false]) {" \
  "$LF2"
prouver "une quantité déduite d'un nombre sans décimales" serveur/achats/lecture-facture.ts \
  "        const unPrix = /[.,]/.test(g[iPrix]?.texte ?? '');" "        const unPrix = true;" \
  "$LF4"
prouver "« 1 500,000 » lu cinq cents" serveur/achats/lecture-facture.ts \
  "  const colle = groupements(nombres).reduce((a, b) => (b.length < a.length ? b : a), nombres);" "  const colle = nombres;" \
  "$LF4"
prouver "une remise de 0 % prise pour une TVA à 0 %" serveur/achats/lecture-facture.ts \
  "  const colonnes = [...entete.matchAll(" "  const colonnes = [...''.matchAll(" \
  "$LF3"
prouver "les traits du tableau pris pour des mots" serveur/achats/lecture-facture.ts \
  "  const mots = texte.replace(/[|¦]+/g, ' ')" "  const mots = texte.replace(/[¦]+/g, ' ')" \
  "$LF3"
prouver "la fin du tableau au récapitulatif de la TVA oubliée" serveur/achats/lecture-facture.ts \
  "|remise|base|taux|fodec|" "|remise|base|fodec|" \
  "$LF3"
prouver "l'en-tête du tableau sur deux lignes jamais reconnu" serveur/achats/lecture-facture.ts \
  " && (ENTETE_COLONNES.test(l.compact) || ENTETE_COLONNES.test(lignes[i + 1]?.compact ?? '')));" " && ENTETE_COLONNES.test(l.compact));" \
  "$LF2"
prouver "une date de livraison prise pour la date de la pièce" serveur/achats/lecture-facture.ts \
  "  const AUTRE = /(?:livraison|commande|devis|periode|validite|naissance)/;" "  const AUTRE = /(?:jamais)/;" \
  "$LR6"
prouver "les étiquettes au-dessus de leurs valeurs jamais lues" serveur/achats/lecture-facture.ts \
  "  if (dessous && !toutes.some(" "  if (false && !toutes.some(" \
  "$LR6"
prouver "une pièce adressée à un autre, tue" serveur/achats/lecture-facture.ts \
  "  if (nous && !matricules.some((m) => m.compact === nous) && autres[0]) remarques.push(" "  if (false) remarques.push(" \
  "$LR7"
prouver "le FODEC oublié dans le recomptage" serveur/achats/lecture-facture.ts \
  "htCompte + tvaCompte + (fees ?? 0n) + (fodec ?? 0n) : null;" "htCompte + tvaCompte + (fees ?? 0n) : null;" \
  "$LR8"
prouver "une pièce presque vide, tue" serveur/achats/lecture-facture.ts \
  "  if (!duFournisseur && totalLu === null && totalHT === null && !date) remarques.push(motif('achats.lecture.presque_rien'));" "" \
  "$LR9"
prouver "un montant en euros écrit au millième" serveur/achats/lecture-facture.ts \
  "  const decimales = devise && devise !== 'TND' && f.endsWith('0') ? f.slice(0, 2) : f;" "  const decimales = f;" \
  "$LF5"
prouver "le fichier gardé sur le serveur après la lecture" serveur/achats/lecteur.ts \
  "      await fs.rm(dossier, { recursive: true, force: true });" "      void dossier;" \
  "$LS1"
prouver "un PDF scanné jamais passé au moteur des photos" serveur/achats/lecteur.ts \
  "if (lettres(texte) >= 40) return" "if (true) return" \
  "$LS2"
prouver "un PDF écrit par un logiciel lu comme une photo" serveur/achats/lecteur.ts \
  "if (lettres(texte) >= 40) return" "if (false) return" \
  "$LS2"
prouver "la file du lecteur sans limite" serveur/achats/lecteur.ts \
  "      if (actives < simultanees) actives++;" "      if (true) actives++;" \
  "$LS4"
prouver "un créneau de lecture jamais rendu" serveur/achats/lecteur.ts \
  "        if (suivant) suivant.ok(); else actives--;" "        if (suivant) suivant.ok();" \
  "$LS4"
prouver "un serveur sans moteur qui ne le dit pas" serveur/achats/routes.ts \
  "      if (!lecteur?.disponible) return" "      if (false) return" \
  "$LS4"
prouver "ce qui n'est ni une photo ni un PDF envoyé au moteur" serveur/achats/routes.ts \
  "      if (!sorte) return { statut: 415," "      if (false) return { statut: 415," \
  "$LS3"
prouver "un fichier trop lourd lu quand même" serveur/achats/routes.ts \
  "      if (fichier.length > LIMITE_FICHIER) {" "      if (false) {" \
  "$LS3"
prouver "le matricule de l'acheteur pas donné à la lecture" serveur/achats/routes.ts \
  "      const p = lireFacture(lu.texte, { notreMatricule });" "      const p = lireFacture(lu.texte, {});" \
  "$LSA"
prouver "un commercial qui lit les factures d'achat" serveur/achats/gestes.ts \
  "    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui' } }," "    roles: { proprietaire: 'oui', administrateur: 'oui', comptabilite_interne: 'oui', commercial: 'oui' } }," \
  "$LS5"
prouver "un banc qui passe sur un lot vide" banc/lecture/mesurer.ts \
  "seuilAtteint: lignes.length > 0 && justes * SEUIL.sur" "seuilAtteint: justes * SEUIL.sur" \
  "$LB2"
prouver "un banc qui ne compare pas le total" banc/lecture/mesurer.ts \
  "      total: memeMontant(lu.total, attendu.total)," "      total: true," \
  "$LB2"
prouver "un taux non lu devenu une TVA à 0 %" web/public/v10/core.js \
  "      vatRate: l.vatRate != null && l.vatRate !== '' && VAT_RATES.includes(ocrNumber(l.vatRate))" "      vatRate: VAT_RATES.includes(ocrNumber(l.vatRate))" \
  "$LV1"
prouver "la ligne lue jamais montrée sous les champs" web/public/v10/app.js \
  "    const ici = (html, k) => { const s = luIci(k);" "    const ici = (html, k) => { const s = luIci(k) && '';" \
  "$LW1"
prouver "le recomptage du serveur jamais montré" web/public/plateforme/pont.js \
  "{ remarques: r.remarques || [], ou: r.ou || {}, moteur: r.moteur }" "{ ou: r.ou || {}, moteur: r.moteur }" \
  "$LW1"
prouver "le bouton de lecture caché sur la plateforme" web/public/v10/app.js \
  "    if (!OCR_EN_PAUSE || (bridge.lectureSurLeServeur && isNew && !clos)) bridge.ocrStatus()" "    if (!OCR_EN_PAUSE) bridge.ocrStatus()" \
  "$LW1"
prouver "le bouton de lecture sur un achat déjà enregistré" web/public/v10/app.js \
  "(bridge.lectureSurLeServeur && isNew && !clos)" "(bridge.lectureSurLeServeur && !clos)" \
  "$LW1"
prouver "la lecture qui essaie de joindre la photo sans pièces jointes" web/public/v10/app.js \
  "      const jointe = bridge.piecesJointes === false ? false : await joindreFichier(file);" "      const jointe = await joindreFichier(file);" \
  "$LW1"
prouver "un échec de lecture qui propose de joindre la photo, sans pièces jointes" web/public/v10/app.js \
  "        if (bridge.piecesJointes === false) return infoDialog('La lecture de la facture a échoué', e.message || 'Erreur inconnue.');
" "" \
  "$LW2"
prouver "la ligne lue coupée sur un téléphone" web/public/v10/app.js \
  "style=\"display:block;margin-top:3px;overflow-wrap:anywhere\"" "style=\"display:block;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\"" \
  "$LW2"
# Lot téléphone (06/10/2026) : les lignes de l'écran d'achat sont une grille au téléphone ; le cadre qui défile ne sert
# plus qu'aux autres tableaux de lignes d'achat. Le défaut d'avant (la page qui déborde) revient sans l'un ni l'autre.
prouver "les lignes d'un achat qui débordent du téléphone" web/public/plateforme/telephone.css \
  "  table.lines-edit.buy-lines { display: block; overflow-x: auto; }
|||  @supports selector(:has(*)) {" "|||  @supports not selector(:has(*)) {" \
  "$RV"
prouver "les cases d'un achat trop petites pour un doigt" web/public/plateforme/telephone.css \
  "  table.lines-edit.buy-lines td input, table.lines-edit.buy-lines td select { min-width: 72px; }
|||  @supports selector(:has(*)) {" "|||  @supports not selector(:has(*)) {" \
  "$RV"

# ── Brique 85 : les classeurs Excel lus en ligne, par un lecteur partagé (docs/pont-v10.md) ──
TB1="Nadia importe ses clients depuis un classeur Excel"
TB2="un client tenu commence son livre avec la balance d'un CSV ; un client sur SkanFact reprend ses soldes depuis Excel, refusés tant qu'ils ne tombent pas juste"
prouver "l'entreprise qui lit un classeur sans le décompresser" web/public/plateforme/pont.js \
  "await /** @type {any} */ (window).SkanTableur.lire(octets, f.name);" "/** @type {any} */ (window).SkanCompta.lireFichierTexte(octets, f.name, {});" \
  "$TB1"
prouver "le lecteur des classeurs absent de la page de l'entreprise" web/public/v10/index.html \
  "  <script src=\"../plateforme/tableur.js\"></script>
" "" \
  "$TB1"
prouver "le lecteur des classeurs absent de la page du Cabinet" web/public/v10/cabinet/index.html \
  "  <script src=\"../../plateforme/tableur.js\"></script>
" "" \
  "$TB2"

# ── Brique 86 : les commandes livrées en plusieurs fois, et plusieurs bons en une facture (docs/livraisons.md) ──
LC1="le bon d'une commande reprend ce qui reste ; livrée en partie, puis livrée ; un brouillon est en préparation, un bon annulé ne compte pas"
LC2="« livrée » choisie à la main clôt la commande ; un bon d'avant le rattachement se lit ligne à ligne"
LC3="plusieurs bons d'un client font une facture égale à la commande ; un bon facturé ne se propose plus ; le stock ne sort qu'une fois"
LC4="chaque bon d'une commande se facture à part : la facture d'un bon ne couvre pas l'autre ; une facture de toute la vente les couvre tous"
LCW="Nadia livre la commande en deux fois, puis facture les deux bons en une facture égale à la commande"
LCS="une facture émise ne change plus ce qui a été scellé et ne s'efface pas ; ses règlements et son heure d'émission, oui"
prouver "le bon suivant d'une commande qui reprend toute la commande" web/public/v10/core.js \
  "    out.lines = (out.lines || []).map((l, i) => ({ ...l, qty: s.lignes[i] ? s.lignes[i].aProposer : 0, ligneCommande: i }))" "    out.lines = (out.lines || []).map((l, i) => ({ ...l, ligneCommande: i }))" \
  "$LC1"
prouver "un bon en brouillon compté comme livré" web/public/v10/core.js \
  "  const BON_LIVRE = ['émis', 'signé'];" "  const BON_LIVRE = ['émis', 'signé', 'brouillon'];" \
  "$LC1"
prouver "un bon annulé compté parmi les bons de la commande" web/public/v10/core.js \
  "        if (d.type !== 'livraison' || !d.fromDocId || /^annul/.test(d.status || '')) return;" "        if (d.type !== 'livraison' || !d.fromDocId) return;" \
  "$LC1"
prouver "une commande livrée en partie dite reçue" web/public/v10/core.js \
  "      return s.livree ? 'livrée' : s.partielle ? 'partielle' : 'reçue';" "      return s.livree ? 'livrée' : 'reçue';" \
  "$LC1"
prouver "le statut « livrée en partie » dit « partiellement payée »" web/public/v10/core.js \
  "    if (s === 'partielle' && type === 'commande') return 'livrée en partie';
" "" \
  "$LC1"
prouver "« livrée » choisie à la main rouverte par les bons" web/public/v10/core.js \
  "      if (doc.status !== 'reçue' || !data) return doc.status;" "      if (!data) return doc.status;" \
  "$LC2"
prouver "un bon d'avant le rattachement ignoré" web/public/v10/core.js \
  "        const i = rattache ? l.ligneCommande : (source[j] && (source[j].label || '') === (l.label || '') ? j : null);" "        const i = l.ligneCommande;" \
  "$LC2"
prouver "une ligne de commande livrée en deux fois facturée en deux lignes" web/public/v10/core.js \
  "      if (deja) { deja.qty = round3((Number(deja.qty) || 0) + (Number(l.qty) || 0)); return; }" "" \
  "$LC3"
prouver "des bons de deux clients ou de deux devises sur une facture" web/public/v10/core.js \
  "    if (bons.some(b => b.clientId !== bons[0].clientId || devise(b) !== devise(bons[0]))) return null;" "" \
  "$LC3"
prouver "un bon facturé encore proposé" web/public/v10/core.js \
  "BON_LIVRE.includes(d.status) && !factureDuBon(data, d)));" "BON_LIVRE.includes(d.status)));" \
  "$LC3"
prouver "l'historique d'un bon sans la facture qui le regroupe" web/public/v10/core.js \
  "    return (data.documents || []).filter(d => d.fromDocId === doc.id || (d.type === 'facture' && Array.isArray(d.bonsLivraison) && d.bonsLivraison.some(b => b.id === doc.id)))" "    return (data.documents || []).filter(d => d.fromDocId === doc.id)" \
  "$LC3"
prouver "une pièce tirée d'une facture de plusieurs bons qui les couvre encore" web/public/v10/core.js \
  "    'bonsLivraison'];" "    ];" \
  "$LC3"
prouver "la facture d'un bon qui couvre les autres bons de la commande" web/public/v10/core.js \
  "        else if (!f.deposit) { const r = racine(f); if (!parVente.has(r)) parVente.set(r, f); }" "        if (!f.deposit) { const r = racine(f); if (!parVente.has(r)) parVente.set(r, f); }" \
  "$LC4"
prouver "une facture d'acompte qui couvre la marchandise" web/public/v10/core.js \
  "        else if (!f.deposit) { const r = racine(f); if (!parVente.has(r)) parVente.set(r, f); }" "        else { const r = racine(f); if (!parVente.has(r)) parVente.set(r, f); }" \
  "$LC4"
prouver "une facture de toute la vente qui ne couvre pas ses bons" web/public/v10/core.js \
  "    return x.parBon.get(bon.id) || x.parVente.get(x.racine(bon)) || null;" "    return x.parBon.get(bon.id) || null;" \
  "$LC4"
prouver "la facture de plusieurs bons sans ses bons imprimés" web/public/v10/core.js \
  "        ? [doc.bonsLivraison.length > 1 ? L.deliveryNotes : L.deliveryNote1, doc.bonsLivraison.map(b => b.number).filter(Boolean).join(', ')] : null," "        ? null : null," \
  "$LCW"
prouver "le panneau des livraisons absent de la commande" web/public/v10/app.js \
  "          \${suiviCde && suiviCde.bons.length ? panneauLivraisons(stored, suiviCde) : ''}" "" \
  "$LCW"
prouver "« Livrer le reste » du panneau qui ne fait rien" web/public/v10/app.js \
  "\$\$('#conv-list button, #more-list [data-conv], #livrer-reste')" "\$\$('#conv-list button, #more-list [data-conv]')" \
  "$LCW"
prouver "le bon suivant tiré de toute la commande" web/public/v10/app.js \
  "    const out = src.type === 'commande' && t === 'livraison'" "    const out = false" \
  "$LCW"
prouver "« Facturer des bons… » absent de la liste des bons" web/public/v10/app.js \
  "\${aFacturer.length ? '<button class=\"btn btn-primary\" id=\"facturer-bons\">Facturer des bons…</button>' : ''}" "" \
  "$LCW"
prouver "la fenêtre qui annonce la somme des bons pour le montant de la facture" web/public/v10/app.js \
  "        const total = inv ? C.computeTotals(inv, company()).netHT : 0;" "        const total = inv ? bons.reduce((s, b) => s + C.computeTotals(b, company()).netHT, 0) : 0;" \
  "$LCW"
prouver "la liste des commandes qui filtre sur le statut enregistré" web/public/v10/app.js \
  "        .filter(d => !s.st || effStatus(d) === s.st)" "        .filter(d => !s.st || d.status === s.st)" \
  "$LCW"
prouver "le menu d'une commande livrée en partie sans « Livrer le reste »" web/public/v10/app.js \
  "          if (suivi && suivi.bons.length && suivi.aProposer && d.status !== 'livrée') {" "          if (false) {" \
  "$LCW"
prouver "« Facturer avec d'autres bons… » absent du menu d'un bon" web/public/v10/app.js \
  "        a.push({ icon: 'facture', label: 'Facturer avec d\'autres bons…', hint: 'Une seule facture pour plusieurs bons de ce client', run: () => facturerDesBons(d.clientId) });" "        ;" \
  "$LCW"
prouver "« Transformer » d'une commande livrée en partie qui n'est plus l'étape suivante" web/public/v10/app.js \
  "      : resteALivrer ? 'transform'" "      : false ? 'transform'" \
  "$LCW"
prouver "une copie de la facture qui reprend ses bons de livraison" web/public/v10/app.js \
  "settles: undefined, recurringId: undefined, bonsLivraison: undefined };" "settles: undefined, recurringId: undefined };" \
  "$LCW"
prouver "les bons de livraison d'une facture émise hors du scellé" serveur/v10/dossier.ts \
  "'applyStamp', 'bonsLivraison', 'stampFee'" "'applyStamp', 'stampFee'" \
  "$LCS"

# ── Brique 87 : les commandes fournisseurs et leurs réceptions, même partielles (docs/commandes-fournisseurs.md) ──
CF1="la réception reprend ce qui reste ; reçue en partie, puis reçue ; un brouillon est en préparation, une réception annulée ne compte pas"
CF2="« soldée » ou « annulée » à la main clôt la commande ; les numéros suivent leur propre série"
CF3="une réception validée fait entrer la marchandise en stock, au prix de la commande en dinars ; la facture saisie depuis elle, non"
CF4="une réception validée attend sa facture jusqu'à ce qu'un achat la couvre ; la commande s'imprime pour le fournisseur"
CFW="Nadia commande à son fournisseur, reçoit en deux fois, puis saisit sa facture depuis les réceptions"
prouver "la réception suivante qui reprend toute la commande" web/public/v10/core.js \
  "    const lines = (commande.lines || []).map((l, i) => ({ ...JSON.parse(JSON.stringify(l)), qty: s.lignes[i] ? s.lignes[i].aProposer : 0, ligneCommande: i }))" "    const lines = (commande.lines || []).map((l, i) => ({ ...JSON.parse(JSON.stringify(l)), ligneCommande: i }))" \
  "$CF1"
prouver "une réception en brouillon comptée comme reçue" web/public/v10/core.js \
  "      if (r.status === 'validée') x.recue = round3(x.recue + q);" "      if (r.status === 'validée' || r.status === 'brouillon') x.recue = round3(x.recue + q);" \
  "$CF1"
prouver "une réception annulée comptée parmi celles de la commande" web/public/v10/core.js \
  "    return (data.receptions || []).filter(r => r.orderId === commande.id && !/^annul/.test(r.status || ''))" "    return (data.receptions || []).filter(r => r.orderId === commande.id)" \
  "$CF1"
prouver "une commande reçue en partie qui se dit encore envoyée" web/public/v10/core.js \
  "    return s.recue ? 'reçue' : s.partielle ? 'partielle' : st;" "    return s.recue ? 'reçue' : st;" \
  "$CF1"
prouver "« soldée » choisie à la main rouverte par les réceptions" web/public/v10/core.js \
  "    if (st === 'soldée' || /^annul/.test(st)) return st;" "    if (/^annul/.test(st)) return st;" \
  "$CF2"
prouver "le numéro suivant qui ignore les numéros déjà portés" web/public/v10/core.js \
  "    const n = Math.max(vus.length ? Math.max(...vus) : 0, data.counters[cle] || 0) + 1;" "    const n = (data.counters[cle] || 0) + 1;" \
  "$CF2"
prouver "le compteur des commandes et des réceptions oublié" web/public/v10/core.js \
  "    data.counters[cle] = n;
" "" \
  "$CF2"
prouver "une réception en brouillon qui fait entrer la marchandise en stock" web/public/v10/core.js \
  "      if (r.status !== 'validée') return;
" "" \
  "$CF3"
prouver "une réception validée qui ne fait rien entrer en stock" web/public/v10/core.js \
  "    (data.receptions || []).forEach(r => {" "    ([]).forEach(r => {" \
  "$CF3"
prouver "une réception en devise entrée en stock au prix en devise" web/public/v10/core.js \
  "          unitCost: toBase(r, Number(l.unitPrice) || 0, data.company || {})," "          unitCost: Number(l.unitPrice) || 0," \
  "$CF3"
prouver "une réception comptée comme une charge du mois" web/public/v10/core.js \
  "  const SOURCES_HORS_CHARGE = ['achat', 'reception', 'depart'];" "  const SOURCES_HORS_CHARGE = ['achat', 'depart'];" \
  "$CF3"
prouver "la facture des réceptions qui fait entrer leur marchandise une seconde fois" web/public/v10/core.js \
  "        if (l.recue) return;
" "" \
  "$CF3"
prouver "une ligne de commande reçue en deux fois facturée en deux lignes" web/public/v10/core.js \
  "      if (deja) { deja.qty = round3(deja.qty + ligne.qty); return; }" "" \
  "$CF3"
prouver "la facture des réceptions sans la marque « reçue »" web/public/v10/core.js \
  "deductible: true, recue: true, ...(l.itemId ? { itemId: l.itemId } : {}) };" "deductible: true, ...(l.itemId ? { itemId: l.itemId } : {}) };" \
  "$CF3"
prouver "la marchandise suivie des réceptions facturée en charge" web/public/v10/core.js \
  "        destination: c && c.tracked ? 'stock' : 'charge', deductible: true, recue: true," "        destination: 'charge', deductible: true, recue: true," \
  "$CF3"
prouver "une réception facturée encore proposée" web/public/v10/core.js \
  "    return (data.receptions || []).filter(r => r.status === 'validée' && !couvertes.has(r.id) && (!supplierId || r.supplierId === supplierId));" "    return (data.receptions || []).filter(r => r.status === 'validée' && (!supplierId || r.supplierId === supplierId));" \
  "$CF4"
prouver "une réception en brouillon proposée à la facture" web/public/v10/core.js \
  "    return (data.receptions || []).filter(r => r.status === 'validée' && !couvertes.has(r.id) && (!supplierId || r.supplierId === supplierId));" "    return (data.receptions || []).filter(r => !couvertes.has(r.id) && (!supplierId || r.supplierId === supplierId));" \
  "$CF4"
prouver "les réceptions d'un autre fournisseur proposées à la facture" web/public/v10/core.js \
  "    return (data.receptions || []).filter(r => r.status === 'validée' && !couvertes.has(r.id) && (!supplierId || r.supplierId === supplierId));" "    return (data.receptions || []).filter(r => r.status === 'validée' && !couvertes.has(r.id));" \
  "$CF4"
prouver "la commande imprimée adressée comme un devis" web/public/v10/core.js \
  "\${isSupplierOrder ? L.supplier : isInvoice || isProforma ? L.billedTo" "\${isInvoice || isProforma ? L.billedTo" \
  "$CF4"
prouver "la commande imprimée sans la livraison souhaitée" web/public/v10/core.js \
  "      doc.dueDate ? [L.wantedBy, fmtDate(doc.dueDate)] : null," "      null," \
  "$CF4"
prouver "la commande imprimée sans la demande de confirmation" web/public/v10/core.js \
  "\${isDemandePrix ? L.demandePrixNote : L.supplierOrderNote}" "\${isDemandePrix ? L.demandePrixNote : ''}" \
  "$CF4"
prouver "les commandes fournisseurs absentes du menu" web/public/v10/core.js \
  "    { id: 'commandesf', titre: 'Commandes fournisseurs', module: 'achats', famille: 'Acheter'," "    { id: 'commandesf-absente', titre: 'Commandes fournisseurs', module: 'achats', famille: 'Acheter'," \
  "$CFW"
prouver "une commande qui n'allume pas son entrée du menu" web/public/v10/app.js \
  "    else if (name === 'commandef' || name === 'reception') active = 'commandesf';
" "" \
  "$CFW"
prouver "les quantités de la commande arrondies comme un montant" web/public/v10/app.js \
  "data-k=\"qty\" data-i=\"\${i}\" value=\"\${h(l.qty)}\" step=\"any\"" "data-k=\"qty\" data-i=\"\${i}\" value=\"\${h(l.qty)}\" step=\"0.001\"" \
  "$CFW"
prouver "les quantités reçues arrondies comme un montant" web/public/v10/app.js \
  "data-rq=\"\${i}\" value=\"\${h(l.qty)}\" step=\"any\"" "data-rq=\"\${i}\" value=\"\${h(l.qty)}\" step=\"0.001\"" \
  "$CFW"
prouver "une commande enregistrée sans numéro" web/public/v10/app.js \
  "      if (!o.number) o.number = C.numeroSuivant(data, commandesF(), 'BCF', o.date);
" "" \
  "$CFW"
prouver "les lignes d'une commande en préparation encore modifiables" web/public/v10/app.js \
  "    const figee = !!(suivi && suivi.receptions.length);" "    const figee = recue;" \
  "$CFW"
prouver "une réception qui ne se valide pas" web/public/v10/app.js \
  "        r.status = 'validée';
" "" \
  "$CFW"
prouver "une réception validée sans numéro" web/public/v10/app.js \
  "        r.number = r.number || C.numeroSuivant(data, receptionsF(), 'BR', r.date);
" "" \
  "$CFW"
prouver "« Recevoir le reste » qui se dit « Recevoir »" web/public/v10/app.js \
  "\${suivi.receptions.length ? 'Recevoir le reste' : 'Recevoir'}" "Recevoir" \
  "$CFW"
prouver "le panneau des réceptions absent de la commande" web/public/v10/app.js \
  "\${suivi && suivi.receptions.length ? \`<div class=\"panel\" id=\"receptions-panel\">" "\${false ? \`<div class=\"panel\" id=\"receptions-panel\">" \
  "$CFW"
prouver "« Saisir la facture du fournisseur » absent d'une réception validée" web/public/v10/app.js \
  "\${valide && !facturee ? '<button class=\"btn btn-primary\" id=\"rec-facturer\">Saisir la facture du fournisseur</button>' : ''}" "" \
  "$CFW"
prouver "la facture tirée de la seule réception affichée" web/public/v10/app.js \
  "facturerReceptions(C.receptionsAFacturer(data).filter(x => x.orderId === r.orderId || x.id === r.id))" "facturerReceptions(C.receptionsAFacturer(data).filter(x => x.id === r.id))" \
  "$CFW"
prouver "la facture des réceptions sans son lien aux réceptions" web/public/v10/app.js \
  "    p.receptions = recs.map(r => ({ id: r.id, number: r.number || '' }));
" "" \
  "$CFW"
prouver "la copie d'un achat qui couvre encore ses réceptions" web/public/v10/app.js \
  "    delete copy.receptions;
" "" \
  "$CFW"
prouver "la copie d'un achat dont la marchandise n'entre pas en stock" web/public/v10/app.js \
  "    copy.lines = (copy.lines || []).map(C.copieLigneAchat);
" "" \
  "$CFW"
prouver "la copie d'une ligne reçue qui garde sa marque" web/public/v10/core.js \
  "    delete x.recue;
" "" \
  "$CF3"
prouver "le bouton ⧉ qui recopie la marque « reçue »" web/public/v10/app.js \
  "p.lines.splice(i + 1, 0, C.copieLigneAchat(p.lines[i]))" "p.lines.splice(i + 1, 0, deepCopy(p.lines[i]))" \
  "$CFW"
prouver "les lignes reçues d'un achat qui ne le disent pas" web/public/v10/app.js \
  "\${l.recue ? \`<div class=\"small muted nw\" data-recue" "\${false ? \`<div class=\"small muted nw\" data-recue" \
  "$CFW"

# ── Brique 88 : les écarts entre la facture du fournisseur et ses réceptions (docs/commandes-fournisseurs.md) ──
CF5="la facture se compare à ce qui a été reçu : une quantité, un prix, une ligne oubliée ; la copie d'une ligne ne compte pas"
prouver "une ligne de facture comparée à la première ligne de commande de son nom" web/public/v10/core.js \
  "      if (cle) { ligne.origine = { commande: r.orderId, ligne: l.ligneCommande }; parCle.set(cle, ligne); }" "      if (cle) parCle.set(cle, ligne);" \
  "$CF5"
prouver "la copie d'une ligne reçue qui garde sa ligne de commande" web/public/v10/core.js \
  "    delete x.origine;
" "" \
  "$CF3"
prouver "une quantité facturée autre que la quantité reçue passée sous silence" web/public/v10/core.js \
  "      if (Math.abs(q - a.qty) > 0.0005) out.push(" "      if (false) out.push(" \
  "$CF5"
prouver "un prix facturé autre que celui de la commande passé sous silence" web/public/v10/core.js \
  "      if (memeDevise && Math.abs(pu - a.unitPrice) > 0.0005) out.push(" "      if (false) out.push(" \
  "$CF5"
prouver "une ligne reçue oubliée par la facture passée sous silence" web/public/v10/core.js \
  "      if (!l) { out.push({ ...quoi, genre: 'absente', recu: a.qty }); return; }" "      if (!l) return;" \
  "$CF5"
prouver "des prix comparés d'une devise à l'autre" web/public/v10/core.js \
  "    const memeDevise = (p.currency || base) === (recs[0].currency || base);" "    const memeDevise = true;" \
  "$CF5"
prouver "les écarts qui ne se disent pas pendant la saisie" web/public/v10/app.js \
  "      if (\$('#b-ecarts')) \$('#b-ecarts').innerHTML" "      if (false) \$('#b-ecarts').innerHTML" \
  "$CFW"
prouver "la commande qui ne nomme pas la facture de ses réceptions" web/public/v10/app.js \
  "\${factures.length ? \`<p class=\"small\" id=\"cf-factures\">" "\${false ? \`<p class=\"small\" id=\"cf-factures\">" \
  "$CFW"
prouver "la commande qui tait l'écart de sa facture" web/public/v10/app.js \
  "return \`<a href=\"#/achat/\${h(f.id)}\">\${h(f.number || 'sans numéro')}</a>\${n ?" "return \`<a href=\"#/achat/\${h(f.id)}\">\${h(f.number || 'sans numéro')}</a>\${false ?" \
  "$CFW"

# ── Brique 89 : la demande de prix, à un ou plusieurs fournisseurs (docs/commandes-fournisseurs.md) ──
CF6="une demande de prix envoyée à trois fournisseurs se compare ligne à ligne, en dinars ; elle s'imprime sans prix"
CFD="Nadia demande ses prix à deux fournisseurs, compare leurs réponses, puis commande chez le moins cher"
prouver "la demande de prix absente des statuts" web/public/v10/core.js \
  "  const STATUTS_COMMANDE_FOURNISSEUR = ['demande', 'brouillon', 'envoyée', 'soldée', 'annulée'];" "  const STATUTS_COMMANDE_FOURNISSEUR = ['brouillon', 'envoyée', 'soldée', 'annulée'];" \
  "$CFD"
prouver "une demande commandée encore comparée" web/public/v10/core.js \
  "    return (data.supplierOrders || []).filter(x => x.status === 'demande' && (x.groupe || x.id) === g);" "    return (data.supplierOrders || []).filter(x => (x.groupe || x.id) === g);" \
  "$CF6"
prouver "des prix en devise comparés sans être ramenés en dinars" web/public/v10/core.js \
  "return pu > 0 ? toBase(x, pu, co) : null; });" "return pu > 0 ? pu : null; });" \
  "$CF6"
prouver "une demande sans toutes ses réponses qui peut gagner" web/public/v10/core.js \
  "      complete: (x.lines || []).length > 0 && (x.lines || []).every(l => (Number(l.unitPrice) || 0) > 0)," "      complete: true," \
  "$CF6"
prouver "une demande de prix imprimée avec des prix" web/public/v10/core.js \
  "    const noPrices = (isDelivery && doc.hidePrices !== false) || isDemandePrix;" "    const noPrices = isDelivery && doc.hidePrices !== false;" \
  "$CF6"
prouver "une demande de prix imprimée comme un bon de commande" web/public/v10/core.js \
  ": isDemandePrix ? L.demandePrix : (L[doc.type] || 'Document');" ": (L[doc.type] || 'Document');" \
  "$CF6"
prouver "une demande de prix « commandée le »" web/public/v10/core.js \
  "      [isDemandePrix ? L.askedOn : L.orderedOn, fmtDate(doc.date)]," "      [L.orderedOn, fmtDate(doc.date)]," \
  "$CF6"
prouver "une demande de prix qui demande de confirmer la commande" web/public/v10/core.js \
  "\${isDemandePrix ? L.demandePrixNote : L.supplierOrderNote}" "\${L.supplierOrderNote}" \
  "$CF6"
prouver "« + Demande de prix » qui crée une commande" web/public/v10/app.js \
  "status: parts[1] === 'demande' ? 'demande' : 'brouillon', date: C.today()" "status: 'brouillon', date: C.today()" \
  "$CFD"
prouver "une demande de prix qu'on peut recevoir" web/public/v10/app.js \
  "suivi.aProposer && !close && !demande);" "suivi.aProposer && !close);" \
  "$CFD"
prouver "une demande de prix qui se dit commande" web/public/v10/app.js \
  "\${demande ? 'Demande de prix' : 'Commande'}" "Commande" \
  "$CFD"
prouver "les titres d'une demande de prix qui parlent de commande" web/public/v10/app.js \
  "    const quoi = o.status === 'demande' ? 'demande' : 'commande';" "    const quoi = 'commande';" \
  "$CFD"
prouver "« Demander aussi à… » qui propose un fournisseur déjà sollicité" web/public/v10/app.js \
  "      const pris = new Set(C.demandesDuGroupe(data, src).map(x => x.supplierId));" "      const pris = new Set();" \
  "$CFD"
prouver "la demande copiée avec les prix de l'autre fournisseur" web/public/v10/app.js \
  "lines: (src.lines || []).map(l => ({ ...deepCopy(l), unitPrice: 0 })) };" "lines: deepCopy(src.lines || []) };" \
  "$CFD"
prouver "une demande commandée sans le prix du fournisseur" web/public/v10/app.js \
  "      if (sansPrix.length) return toast(" "      if (false) return toast(" \
  "$CFD"
prouver "les autres demandes gardées après la commande" web/public/v10/app.js \
  "      autres.forEach(x => { x.status = 'annulée'; x.nonRetenue = true; });" "" \
  "$CFD"
prouver "le prix le moins cher d'une ligne qui ne se lit pas" web/public/v10/app.js \
  ": j === l.meilleur ? \`<b>" ": false ? \`<b>" \
  "$CFD"
prouver "« Commander chez… » le moins cher qui n'est pas le bouton principal" web/public/v10/app.js \
  "\${t.id === groupe.moinsCher ? 'btn-primary' : ''}\" data-commander" "\" data-commander" \
  "$CFD"

# ── Brique 90 : « À faire » annonce les achats et livraisons en attente (docs/commandes-fournisseurs.md) ──
CF7="« À faire » annonce les bons à facturer, les réceptions sans facture et les commandes en retard, avec les fonctions de leurs listes"
AFW="Nadia voit sur son accueil la commande en retard et la réception sans facture, et chaque bouton l'y mène"
prouver "une commande attendue plus tard dite en retard" web/public/v10/core.js \
  "(data.supplierOrders || []).filter(o => o.dueDate && o.dueDate < t && ['envoyée', 'partielle']" "(data.supplierOrders || []).filter(o => o.dueDate && ['envoyée', 'partielle']" \
  "$CF7"
prouver "une commande soldée ou reçue dite en retard" web/public/v10/core.js \
  "o.dueDate < t && ['envoyée', 'partielle'].includes(statutCommandeFournisseur(data, o)));" "o.dueDate < t);" \
  "$CF7"
prouver "les bons à facturer absents de « À faire »" web/public/v10/core.js \
  "    if (bonsAF.length) {" "    if (false) {" \
  "$CF7"
prouver "les réceptions sans facture absentes de « À faire »" web/public/v10/core.js \
  "    if (recAF.length) {" "    if (false) {" \
  "$CF7"
prouver "les commandes en retard absentes de « À faire »" web/public/v10/core.js \
  "    if (enRetard.length) {" "    if (false) {" \
  "$CF7"
prouver "la ligne des commandes en retard qui ne mène nulle part" web/public/v10/app.js \
  "    'commandesf-retard': { label: 'Voir les commandes', run: vers('#/commandesf/commandes') },
" "" \
  "$AFW"
prouver "la ligne des réceptions sans facture qui ne mène nulle part" web/public/v10/app.js \
  "    'receptions-a-facturer': { label: 'Voir les réceptions', run: vers('#/commandesf/receptions') },
" "" \
  "$AFW"
prouver "la liste qui ne marque pas la commande en retard" web/public/v10/app.js \
  "\${enRetard.has(x.id) ? ' <span" "\${false ? ' <span" \
  "$AFW"
prouver "la liste qui ne marque pas la réception à facturer" web/public/v10/app.js \
  "\${aFacturerR.has(x.id) ? ' <span" "\${false ? ' <span" \
  "$AFW"

# ── Brique 91 : l'encours autorisé d'un client (docs/encours.md) ──
EN1="l'encours : les factures non réglées en dinars, plus les bons livrés à facturer ; ni brouillon ni autre client"
EN2="une pièce qui ferait dépasser le plafond se dit avec ses chiffres ; sous le plafond, rien ; les bons déjà comptés ne comptent pas deux fois"
ENW="Nadia plafonne l'encours de son client, puis émet quand même la facture qui le dépasse, prévenue avant"
prouver "une facture en brouillon comptée dans l'encours" web/public/v10/core.js \
  "d.clientId === clientId && d.type === 'facture' && d.status !== 'brouillon' && d.status !== 'annulée')" "d.clientId === clientId && d.type === 'facture' && d.status !== 'annulée')" \
  "$EN1"
prouver "l'encours d'une facture en devise compté sans cours" web/public/v10/core.js \
  "return s + (r > 0.0005 ? toBase(d, r, co) : 0); }, 0));" "return s + (r > 0.0005 ? r : 0); }, 0));" \
  "$EN1"
prouver "les bons livrés comptés hors taxes dans l'encours" web/public/v10/core.js \
  "    const livre = round3(bons.reduce((s, b) => s + toBase(b, computeTotals(b, co).totalTTC, co), 0));" "    const livre = round3(bons.reduce((s, b) => s + toBase(b, computeTotals(b, co).netHT, co), 0));" \
  "$EN1"
prouver "la facture d'un bon qui le compte deux fois" web/public/v10/core.js \
  ".filter(b => siens.has(b.id) || b.id === doc.id)" ".filter(b => false)" \
  "$EN2"
prouver "un client sans plafond averti" web/public/v10/core.js \
  "    if (!plafond || !doc.clientId) return null;" "    if (!doc.clientId) return null;" \
  "$EN2"
prouver "une pièce sous le plafond annoncée comme un dépassement" web/public/v10/core.js \
  "    return apres > plafond + 0.0005 ? {" "    return true ? {" \
  "$EN2"
prouver "émettre au-delà de l'encours sans le dire" web/public/v10/app.js \
  "      if (enc) w.push(" "      if (false) w.push(" \
  "$ENW"
prouver "l'encours autorisé absent de la fiche du client" web/public/v10/app.js \
  "<input type=\"number\" name=\"creditLimit\"" "<input type=\"number\" name=\"creditLimitAbsent\"" \
  "$ENW"
prouver "la page du client qui tait son encours" web/public/v10/app.js \
  "      \${Number(c.creditLimit) > 0 ? (() => { const e = C.encoursClient(" "      \${false ? (() => { const e = C.encoursClient(" \
  "$ENW"

# ── Brique 92 : le prix par quantité (docs/prix-quantite.md) ──
PQ1="le palier le plus haut que la quantité atteint ; sous le premier, le prix de l'article"
PQ2="ce qu'on tape se lit et se trie ; un palier illisible, nul ou en double se refuse en disant lequel"
PQW="Nadia donne au ciment des prix dégressifs, et la ligne de sa facture les suit, jusqu'au prix qu'elle tape"
prouver "un palier qui ne compte qu'au-delà de sa quantité" web/public/v10/core.js \
  "Number(x.prix) > 0 && q >= Number(x.min))" "Number(x.prix) > 0 && q > Number(x.min))" \
  "$PQ1"
prouver "le palier le plus bas atteint au lieu du plus haut" web/public/v10/core.js \
  "      .sort((a, b) => Number(b.min) - Number(a.min))[0];" "      .sort((a, b) => Number(a.min) - Number(b.min))[0];" \
  "$PQ1"
prouver "un palier sans prix qui vend pour rien" web/public/v10/core.js \
  ".filter(x => Number(x.min) > 0 && Number(x.prix) > 0 && q" ".filter(x => Number(x.min) > 0 && q" \
  "$PQ1"
prouver "deux prix pour la même quantité acceptés" web/public/v10/core.js \
  "      if (paliers.some(p => p.min === min)) return {" "      if (false) return {" \
  "$PQ2"
prouver "des paliers gardés dans le désordre" web/public/v10/core.js \
  "    return { paliers: paliers.sort((a, b) => a.min - b.min) };" "    return { paliers };" \
  "$PQ2"
prouver "un palier illisible enregistré sans un mot" web/public/v10/app.js \
  "          if (lusPaliers.erreur) return refus('#cat-paliers', lusPaliers.erreur);" "" \
  "$PQW"
prouver "la quantité qui ne choisit pas le palier" web/public/v10/app.js \
  "            if (el.dataset.k === 'qty' && doc.lines[i].itemId && !doc.lines[i].prixManuel) {" "            if (false) {" \
  "$PQW"
prouver "un prix tapé que la quantité écrase" web/public/v10/app.js \
  "            if (el.dataset.k === 'unitPrice') doc.lines[i].prixManuel = true;" "" \
  "$PQW"

# ── Brique 93 : les listes de prix, par client ou par catégorie (docs/listes-prix.md) ──
LP1="valent pour un client à une date : celles qui le nomment, puis celles de sa catégorie, la plus récente d'abord"
LP2="le prix d'un article : la première liste qui le porte, sinon le palier de sa quantité, sinon le prix de l'article"
LPW="Nadia fait une liste de prix pour ses revendeurs, et leurs factures la suivent"
prouver "une liste qui vaut avant sa date" web/public/v10/core.js \
  "(!l.depuis || l.depuis <= d) && (!l.jusquau || d <= l.jusquau)" "(!l.jusquau || d <= l.jusquau)" \
  "$LP1"
prouver "une liste qui vaut après sa fin" web/public/v10/core.js \
  "(!l.depuis || l.depuis <= d) && (!l.jusquau || d <= l.jusquau)" "(!l.depuis || l.depuis <= d)" \
  "$LP1"
prouver "la liste d'une catégorie qui passe devant celle qui nomme le client" web/public/v10/core.js \
  "      .sort((a, b) => (nomme(b) ? 1 : 0) - (nomme(a) ? 1 : 0) || String(b.depuis" "      .sort((a, b) => String(b.depuis" \
  "$LP1"
prouver "une catégorie écrite autrement qui ne se reconnaît pas" web/public/v10/core.js \
  "  const normCategorie = s => String(s || '').trim().toLowerCase();" "  const normCategorie = s => String(s || '');" \
  "$LP1"
prouver "le prix de la liste ignoré au profit du catalogue" web/public/v10/core.js \
  "      if (x) return { prix: Number(x.prix), source: 'liste', liste: l.nom || '' };" "" \
  "$LP2"
prouver "un article choisi au prix du catalogue malgré la liste du client" web/public/v10/app.js \
  "const pu = C.prixDuCatalogue(C.prixArticlePour(data, it, doc.clientId, doc.date, 1).prix, doc, company())" "const pu = C.prixDuCatalogue(it.unitPrice, doc, company())" \
  "$LPW"
prouver "la catégorie de prix absente de la fiche du client" web/public/v10/app.js \
  "<input type=\"text\" name=\"categorieTarif\"" "<input type=\"text\" name=\"categorieTarifAbsente\"" \
  "$LPW"
prouver "les listes de prix absentes du menu" web/public/v10/core.js \
  "    { id: 'listesprix', titre: 'Listes de prix', module: 'fichiers', famille: 'Vendre'," "    { id: 'listesprix-absente', titre: 'Listes de prix', module: 'fichiers', famille: 'Vendre'," \
  "$LPW"
prouver "une ancienne ligne à un prix choisi que la quantité écrase" web/public/v10/app.js \
  " && Number(auto(ancienneQte)) === Number(doc.lines[i].unitPrice)) {" ") {" \
  "$PQW"

# ── Brique 94 : le stock par dépôt, et les transferts (docs/depots.md) ──
DP1="chaque mouvement appartient au dépôt de sa pièce ; le stock se lit dépôt par dépôt"
DP2="un transfert ne change ni la quantité totale ni le coût moyen ; on ne transfère pas ce qui n'y est pas"
DPW="Nadia ouvre un second magasin, y reçoit du ciment, puis en transfère une partie"
prouver "tous les mouvements rangés au dépôt principal" web/public/v10/core.js \
  "      m.depotId = (art ? art.depotInitial : depotDe.get(m.docId || m.id)) || DEPOT_PRINCIPAL;" "      m.depotId = DEPOT_PRINCIPAL;" \
  "$DP1"
prouver "une réception qui n'entre pas dans son dépôt" web/public/v10/core.js \
  "    [data.purchases, data.receptions, data.documents, data.stockAdjustments].forEach(" "    [data.purchases, data.documents, data.stockAdjustments].forEach(" \
  "$DP1"
prouver "un transfert de ce que le dépôt n'a pas" web/public/v10/core.js \
  "    if (qty > dispo + 0.0005) return {" "    if (false) return {" \
  "$DP2"
prouver "un transfert d'un dépôt vers lui-même" web/public/v10/core.js \
  "    if (!t.de || !t.vers || t.de === t.vers) return {" "    if (!t.de || !t.vers) return {" \
  "$DP2"
prouver "un transfert qui entre à un coût imposé" web/public/v10/core.js \
  "    const commun = { date: t.date, itemId: t.itemId, unitCost: ''," "    const commun = { date: t.date, itemId: t.itemId, unitCost: 0," \
  "$DP2"
prouver "l'entrée d'un transfert rangée avant sa sortie" web/public/v10/core.js \
  "depotId: t.vers, createdAt: commun.createdAt + 1," "depotId: t.vers," \
  "$DP2"
prouver "le dépôt choisi sur la réception oublié" web/public/v10/app.js \
  "      if (v.depotId) r.depotId = v.depotId;
" "" \
  "$DPW"
prouver "un transfert qui ne s'enregistre pas" web/public/v10/app.js \
  "          r.ajustements.forEach(a => data.stockAdjustments.push(a));" "" \
  "$DPW"
prouver "la moitié d'un transfert supprimée seule" web/public/v10/app.js \
  "      const ids = paire.length > 1 ? paire.map(x => x.id) : [b.dataset.rm];" "      const ids = [b.dataset.rm];" \
  "$DPW"
prouver "la ligne d'une réception qui mène à une page de vente" web/public/v10/app.js \
  " : m.source === 'reception' ? '#/reception/' : '#/doc/'}" " : '#/doc/'}" \
  "$DPW"
prouver "la page de l'article qui tait son stock par dépôt" web/public/v10/app.js \
  "      \${C.depotsDe(data).length > 1 ? \`<p class=\"small mb\" id=\"art-depots\">" "      \${false ? \`<p class=\"small mb\" id=\"art-depots\">" \
  "$DPW"

# ── Brique 95 : le dépôt sur les ventes et les achats (docs/depots.md) ──
DP3="le stock insuffisant se lit dans le dépôt de la pièce (brique 95)"
DPW2="Nadia range un achat à Sfax, puis vend depuis le dépôt qui a la marchandise ; l'avoir y rentre"
prouver "le stock insuffisant lu sur tous les dépôts" web/public/v10/core.js \
  "      const depot = depotsDe(data).length > 1 ? (doc.depotId || DEPOT_PRINCIPAL) : '';" "      const depot = '';" \
  "$DP3"
prouver "le dépôt de la pièce lu sans son choix" web/public/v10/core.js \
  "      const have = depot ? (stockParDepot(data, c.id).find(x => x.depotId === depot) || { qty: 0 }).qty : s.qty;" "      const have = depot ? (stockParDepot(data, c.id).find(x => x.depotId === DEPOT_PRINCIPAL) || { qty: 0 }).qty : s.qty;" \
  "$DP3"
prouver "la pièce de vente sans choix de dépôt" web/public/v10/app.js \
  "\${C.depotsDe(data).length > 1 && (isInv || isDelivery || isAv) && doc.fromDocType !== 'livraison' ?" "\${false ?" \
  "$DPW2"
prouver "l'achat sans choix de dépôt" web/public/v10/app.js \
  "\${C.depotsDe(data).length > 1 ? \`<label class=\"field\">\${lbl('Dépôt', 'dep.achat')}" "\${false ? \`<label class=\"field\">\${lbl('Dépôt', 'dep.achat')}" \
  "$DPW2"
prouver "l'avoir tiré d'une facture qui oublie son dépôt" web/public/v10/app.js \
  "      depotId: inv.depotId || ''          //" "      depotId: ''          //" \
  "$DPW2"
prouver "l'avoir qui ne suit pas le dépôt de la facture choisie" web/public/v10/app.js \
  "        if (inv && !figee && \$('select[name=depotId]', head)) { doc.depotId = inv.depotId || C.DEPOT_PRINCIPAL;" "        if (false) { doc.depotId = inv.depotId || C.DEPOT_PRINCIPAL;" \
  "$DPW2"
prouver "l'avertissement qui ne propose jamais le transfert" web/public/v10/app.js \
  "\${x.total >= x.need ? \`Les autres dépôts" "\${false ? \`Les autres dépôts" \
  "$DPW2"

# ── Brique 96 : les kits (docs/kits.md) ──
KT1="vendre un kit sort ses composants ; un avoir les rentre ; le kit se compte en kits possibles"
KT2="« stock insuffisant » regarde les composants du kit"
KTW="Nadia compose un pack chape, le vend, et ses composants sortent du stock"
prouver "un article suivi pris pour un kit" web/public/v10/core.js \
  "  function estKit(c) { return !!c && !c.tracked && Array.isArray(c.composants)" "  function estKit(c) { return !!c && Array.isArray(c.composants)" \
  "$KT1"
prouver "un kit vendu qui sort un seul de chaque composant" web/public/v10/core.js \
  "          const qty = par === 1 ? Number(l.qty) || 0 : round3((Number(l.qty) || 0) * par);" "          const qty = Number(l.qty) || 0;" \
  "$KT1"
prouver "les kits possibles comptés sur le composant le plus abondant" web/public/v10/core.js \
  "    return Math.max(0, Math.min(...ks.map(k => Math.floor(" "    return Math.max(0, Math.max(...ks.map(k => Math.floor(" \
  "$KT1"
prouver "les kits possibles arrondis au-dessus" web/public/v10/core.js \
  "ks.map(k => Math.floor(round3(stockOf(data, k.item.id, toIso).qty / k.qty) + 1e-9))" "ks.map(k => Math.ceil(round3(stockOf(data, k.item.id, toIso).qty / k.qty)))" \
  "$KT1"
prouver "le coût d'un kit sans les quantités de ses composants" web/public/v10/core.js \
  "    return round3(composantsDe(data, kit).reduce((a, k) => a + k.qty * (stockOf(" "    return round3(composantsDe(data, kit).reduce((a, k) => a + (stockOf(" \
  "$KT1"
prouver "le stock insuffisant qui ignore la quantité par kit" web/public/v10/core.js \
  "qty: round3((Number(l.qty) || 0) * k.qty), kit: c.label" "qty: Number(l.qty) || 0, kit: c.label" \
  "$KT2"
prouver "le stock insuffisant qui ne regarde pas les composants" web/public/v10/core.js \
  "    lignesDeStock(doc.lines || [], data).forEach(l => {" "    (doc.lines || []).forEach(l => {" \
  "$KT2"
prouver "un composant sans article accepté" web/public/v10/app.js \
  "          if (kitLu.some(k => !k.itemId)) return refus(" "          if (false) return refus(" \
  "$KTW"
prouver "un même article deux fois dans le kit" web/public/v10/app.js \
  "          if (new Set(kitLu.map(k => k.itemId)).size < kitLu.length) return refus(" "          if (false) return refus(" \
  "$KTW"
prouver "un kit suivi lui-même en stock" web/public/v10/app.js \
  "          if (kitLu.length && v.tracked) return refus(" "          if (false) return refus(" \
  "$KTW"
prouver "les composants d'un kit perdus à l'enregistrement" web/public/v10/app.js \
  "          v.composants = kitLu.map(k => ({ itemId: k.itemId, qty: Number(k.qty) }));" "          v.composants = [];" \
  "$KTW"
prouver "le catalogue qui tait les kits possibles" web/public/v10/app.js \
  "        if (C.estKit(c)) {" "        if (false) {" \
  "$KTW"
prouver "le coût de revient d'un kit laissé à zéro" web/public/v10/app.js \
  "            coutAuto = String(C.coutDuKit(data, lu)); champCout.value = coutAuto;" "            coutAuto = '';" \
  "$KTW"

# ── Brique 97 : les lots (docs/lots.md) ──
LT1="chaque mouvement dit son lot ; le stock se lit lot par lot ; le lot conseillé périme le premier"
LT2="« À faire » dit les lots qui périment ; une pièce dit ses lots manquants, périmés, courts"
LTW="Samia saisit ses yaourts par lot, voit ceux qui périment, et vend le plus ancien"
prouver "la vente qui oublie le lot de sa ligne" web/public/v10/core.js \
  "      (data.documents || []).forEach(d => (d.lines || []).forEach((l, i) => { if (l.lot) lotDe.set(" "      (data.documents || []).forEach(d => (d.lines || []).forEach((l, i) => { if (false) lotDe.set(" \
  "$LT1"
prouver "le lot du stock de départ oublié" web/public/v10/core.js \
  "      (data.catalog || []).forEach(c => { if (c.initialLot) lotDe.set(" "      (data.catalog || []).forEach(c => { if (false) lotDe.set(" \
  "$LT1"
prouver "les lots rangés du plus tardif au plus proche" web/public/v10/core.js \
  "(!a.lot) - (!b.lot) || (a.peremption || '9999').localeCompare(b.peremption || '9999')" "(!a.lot) - (!b.lot) || (b.peremption || '9999').localeCompare(a.peremption || '9999')" \
  "$LT1"
prouver "un lot périmé conseillé à la vente" web/public/v10/core.js \
  "x.lot && x.qty > 0 && (!x.peremption || x.peremption >= t)) || null;" "x.lot && x.qty > 0) || null;" \
  "$LT1"
prouver "« À faire » qui ne regarde que les lots déjà périmés" web/public/v10/core.js \
  "      .filter(x => x.lot && x.qty > 0 && x.peremption && x.peremption <= limite)" "      .filter(x => x.lot && x.qty > 0 && x.peremption && x.peremption < t)" \
  "$LT2"
prouver "un lot périmé jamais dit périmé" web/public/v10/core.js \
  "peremption: x.peremption, qty: x.qty, perime: x.peremption < t })))" "peremption: x.peremption, qty: x.qty, perime: false })))" \
  "$LT2"
prouver "un lot trop court accepté en silence" web/public/v10/core.js \
  "      if (doc.type !== 'avoir' && x.qty < qty) out.push(" "      if (false) out.push(" \
  "$LT2"
prouver "un lot périmé vendu en silence" web/public/v10/core.js \
  "      if (x.peremption && doc.date && x.peremption < doc.date) out.push(" "      if (false) out.push(" \
  "$LT2"
prouver "des lots périmés annoncés comme une simple information" web/public/v10/core.js \
  "      out.push({ id: 'lots-peremption', level: perimes ? 'warn' : 'info'," "      out.push({ id: 'lots-peremption', level: 'info'," \
  "$LT2"
prouver "« À faire » muet sur les lots qui périment" web/public/v10/core.js \
  "    if (aPerimer.length) {" "    if (false) {" \
  "$LTW"
prouver "la ligne d'achat sans lot ni péremption" web/public/v10/app.js \
  "      return \`<div class=\"inline lot-saisie\">" "      return '' && \`<div class=\"inline lot-saisie\">" \
  "$LTW"
prouver "la ligne de vente sans choix du lot" web/public/v10/app.js \
  "      return \`<div class=\"lot-choix\">" "      return '' && \`<div class=\"lot-choix\">" \
  "$LTW"
prouver "l'émission muette sur une ligne sans lot" web/public/v10/app.js \
  "      if ((isInv && doc.fromDocType !== 'livraison') || isAv) C.lotsDeLaPiece(doc, data)" "      if (false) C.lotsDeLaPiece(doc, data)" \
  "$LTW"
prouver "la page de l'article qui tait son stock par lot" web/public/v10/app.js \
  "      \${item.parLot ? \`<p class=\"small mb\" id=\"art-lots\">" "      \${false ? \`<p class=\"small mb\" id=\"art-lots\">" \
  "$LTW"
prouver "l'historique qui tait le lot" web/public/v10/core.js \
  "        if (m.lot) m.note = [m.note, \`lot \${m.lot}\`]" "        if (false) m.note = [m.note, \`lot \${m.lot}\`]" \
  "$LTW"
prouver "« suivre par lot » qui ne coche pas le suivi en stock" web/public/v10/app.js \
  "          if (e.target.checked && !cs.checked) { cs.checked = true; cs.onchange({ target: cs }); }" "          if (false) { cs.checked = true; cs.onchange({ target: cs }); }" \
  "$LTW"
prouver "le lot du départ perdu à l'enregistrement" web/public/v10/app.js \
  "          v.initialLot = String(v.initialLot ?? it.initialLot ?? '').trim();" "          v.initialLot = '';" \
  "$LTW"

# ── Brique 98 : l'accord d'un responsable au-delà de l'encours, par le serveur (docs/accords.md) ──
AC1="sans accord le commercial n'émet pas au-delà ; refusé, il attend ; accordé pour ce montant, il émet, et la pièce porte les deux noms"
AC2="le propriétaire émet au-delà sans accord ; sans le réglage, le commercial aussi ; seul un responsable règle les seuils"
prouver "l'émission qui ne regarde pas l'encours" serveur/v10/dossier.ts \
  "  const accord = type === 'facture' && !ticket ? await controlerEncours(tx, entreprise, cle, doc) : null;" "  const accord = null;" \
  "$AC1"
prouver "le propriétaire arrêté comme un commercial" serveur/v10/accords.ts \
  "  if (await estResponsable(tx, entreprise)) return null;" "  if (false) return null;" \
  "$AC2"
prouver "l'accord exigé même quand l'entreprise ne le demande pas" serveur/v10/accords.ts \
  "  if (societe.encoursAccord !== true) return null;" "  if (false) return null;" \
  "$AC2"
prouver "un accord qui couvre un montant plus grand" serveur/v10/accords.ts \
  "  if (!r || r.statut !== 'accorde' || Number(r.montant) < montant) return null;" "  if (!r || r.statut !== 'accorde') return null;" \
  "$AC1"
prouver "un refus pris pour un accord" serveur/v10/accords.ts \
  "  if (!r || r.statut !== 'accorde' || Number(r.montant) < montant) return null;" "  if (!r || Number(r.montant) < montant) return null;" \
  "$AC1"
prouver "la pièce émise qui tait les deux noms" serveur/v10/dossier.ts \
  "    ...(accord ? { accordEncours: accord } : {}), ...(accordRemise" "    ...({}), ...(accordRemise" \
  "$AC1"
prouver "une demande en double pour le même montant" serveur/v10/routes.ts \
  "and statut = 'en_attente' and montant = \$3" "and statut = 'en_attente' and montant = \$3 and false" \
  "$AC1"
prouver "une demande redécidée" serveur/v10/routes.ts \
  "      if (a.statut !== 'en_attente') throw new Refus('ventes.accord_deja_decide');" "      if (false) throw new Refus('ventes.accord_deja_decide');" \
  "$AC1"
prouver "sa propre demande décidée" serveur/v10/routes.ts \
  "      if (a.mienne) throw new Refus('ventes.accord_le_sien');" "      if (false) throw new Refus('ventes.accord_le_sien');" \
  "$AC2"
prouver "une demande sans dépassement acceptée" serveur/v10/routes.ts \
  "      if (!d) throw new Refus('ventes.accord_inutile');" "      if (false) throw new Refus('ventes.accord_inutile');" \
  "$AC2"
prouver "une demande décidée qui se réécrit en base" base/migrations/0052_accords.sql \
  "  if old.statut <> 'en_attente' then" "  if false then" \
  "$AC1"
prouver "une demande qui naît accordée en base" base/migrations/0052_accords.sql \
  "    if new.statut <> 'en_attente' then
      raise exception 'Une demande d''accord naît en attente.'" "    if false then
      raise exception 'Une demande d''accord naît en attente.'" \
  "$AC1"
prouver "le plafond d'un client changé par un commercial en base" base/migrations/0052_accords.sql \
  "  if new.collection = 'clients' then champ := 'creditLimit';" "  if false then champ := 'creditLimit';" \
  "$AC2"
prouver "le réglage de l'accord changé par un commercial en base" base/migrations/0052_accords.sql \
  "  elsif new.collection = '_racine' and new.cle = 'company' then champ := 'encoursAccord';" "  elsif false then champ := 'encoursAccord';" \
  "$AC2"
prouver "le propriétaire empêché de régler le plafond en base" base/migrations/0052_accords.sql \
  "     and not (socle.mes_roles(new.entreprise) && array['proprietaire', 'administrateur']) then
    if champ = 'creditLimit' then" "     then
    if champ = 'creditLimit' then" \
  "$AC2"

# ── Brique 99 : les droits geste par geste dans le dossier v10 (docs/droits-dossier.md) ──
DD1="chacun ne lit que sa part, et l'écran sait ce qu'il ne doit ni montrer ni renvoyer"
DD2="chacun n'écrit que sa part ; un envoi qui touche une partie interdite n'écrit rien et la nomme"
DD3="la première facture d'une entreprise, émise par un commercial, crée sa série de numéros"
DDW="Karim, commercial, facture son client sans voir la paie ; un prix du catalogue lui est refusé"
prouver "le dossier entier lu par chacun" serveur/v10/droits.ts \
  "  const visibles = objets.filter((o) => permet(roles, regleDe(o.collection, o.cle).voir, false));" "  const visibles = objets;" \
  "$DD1"
prouver "la paie rangée avec les ventes" serveur/v10/droits.ts \
  "  employees: PAIE, payslips: PAIE," "  employees: VENTES, payslips: PAIE," \
  "$DD1"
prouver "l'écriture sans contrôle des parties" serveur/v10/dossier.ts \
  "  if (!options.serveur) verifierEcriture(await mesRoles(tx, entreprise), changements);" "  if (false) verifierEcriture(await mesRoles(tx, entreprise), changements);" \
  "$DD2"
prouver "« voir » pris pour « écrire »" serveur/v10/droits.ts \
  "return a === 'oui' || (!ecrire && a === 'voir');" "return a === 'oui' || a === 'voir';" \
  "$DD2"
prouver "une partie sans règle ouverte à tous" serveur/v10/droits.ts \
  "LISTES[cle] : LISTES[collection]) ?? TOUT;" "LISTES[cle] : LISTES[collection]) ?? TECHNIQUE;" \
  "$DD2"
prouver "le catalogue écrit par le commercial" serveur/v10/droits.ts \
  "  catalog: R('stock.voir', 'ventes.prix.modifier')," "  catalog: R('stock.voir', 'ventes.brouillon.modifier')," \
  "$DD2"
prouver "la série qu'un commercial ne crée pas" base/migrations/0066_serie_par_cle.sql \
  "                                                  else array['proprietaire', 'administrateur', 'commercial'] end)::text[]" "                                                  else array['proprietaire', 'administrateur'] end)::text[]" \
  "$DD3"
prouver "une liste vide sans la règle de sa liste" serveur/v10/droits.ts \
  "RACINE[cle] ?? LISTES[cle] : LISTES[collection]" "RACINE[cle] : LISTES[collection]" \
  "$DDW"
prouver "l'écran qui renvoie ce qu'il ne peut pas écrire" web/public/plateforme/pont.js \
  "      if (!repart(champ)) continue;" "      if (false) continue;" \
  "$DDW"
prouver "une partie non renvoyée prise pour une partie supprimée" web/public/plateforme/pont.js \
  "        if (!repart(collection === '_racine' ? cle : collection)) continue;" "        if (false) continue;" \
  "$DDW"
prouver "la liste de ce qui peut repartir, vide" serveur/v10/droits.ts \
  "    else ecrivables.add(nom);" "    else lectureSeule.add(nom);" \
  "$DDW"
prouver "le prix d'un article accepté à l'écran puis perdu" web/public/v10/app.js \
  "          if (!peutEcrireDossier('catalog')) return refus(" "          if (false) return refus(" \
  "$DDW"
prouver "les paramètres acceptés à l'écran puis perdus" web/public/v10/app.js \
  "      if (!peutEcrireDossier('company')) { toast(" "      if (false) { toast(" \
  "$DDW"

# ── Brique 100 : les écrans de l'accord d'un responsable (docs/accords.md) ──
ACW="Karim demande, Nadia refuse puis accorde, Karim émet"
prouver "le commercial pris pour un responsable" serveur/v10/droits.ts \
  "responsable: permet(roles, 'ventes.accord.donner', true)," "responsable: true," \
  "$DD1"
prouver "le responsable que l'écran ne reconnaît pas" web/public/plateforme/pont.js \
  "    responsable = !!(d && d.responsable === true);" "    responsable = false;" \
  "$ACW"
prouver "le réglage de l'accord perdu à l'enregistrement" web/public/v10/app.js \
  "      data.company.encoursAccord = data.company.encoursAccord === true;" "      data.company.encoursAccord = false;" \
  "$ACW"
prouver "l'avertissement qui dit « émets quand même » à qui ne le peut pas" web/public/v10/app.js \
  "\${isInv && co.encoursAccord && accordsEnLigne() && !estResponsable()" "\${false && co.encoursAccord && accordsEnLigne() && !estResponsable()" \
  "$ACW"
prouver "le refus de l'émission qui ne propose pas l'accord" web/public/v10/app.js \
  "if (e && e.bouton === 'ventes.accord.demander' && bridge.demanderAccord) demanderAccordPour(" "if (false) demanderAccordPour(" \
  "$ACW"
prouver "la facture qui ne montre pas ses gestes au responsable" web/public/v10/app.js \
  "    if (a.statut === 'en_attente' && accordsVus.peutDecider && !a.mienne) {" "    if (false) {" \
  "$ACW"
prouver "l'accueil du responsable muet sur ce qui l'attend" web/public/v10/app.js \
  "l.accords.filter(a => a.statut === 'en_attente' && !a.mienne) : [];" "l.accords.filter(a => a.statut === 'en_attente' && a.mienne) : [];" \
  "$ACW"
prouver "la page des demandes sans ses gestes" web/public/v10/app.js \
  "            ? (l.peutDecider && !a.mienne ? \`<span class=\"inline\">" "            ? (false ? \`<span class=\"inline\">" \
  "$ACW"
prouver "l'accueil de qui a demandé muet sur la décision" web/public/v10/app.js \
  "new Date(a.decideLe).getTime() > semaine && pieceEncoreBrouillon(a.piece, a.geste));" "new Date(a.decideLe).getTime() > semaine && !pieceEncoreBrouillon(a.piece, a.geste));" \
  "$ACW"

# ── Brique 101 : le menu selon le rôle (web/v10/menu-role.txt) ──
MRW="chacun ne voit dans son menu que les pages de son rôle ; une adresse cachée dit pourquoi"
prouver "le menu qui propose les pages cachées" web/public/v10/app.js \
  "    const pages = C.navPages(data).filter(p => !pageCachee(p.id));" "    const pages = C.navPages(data).slice();" \
  "$MRW"
prouver "une page cachée ouverte comme les autres" web/public/v10/app.js \
  "    const dessine = pageCachee(name) ? pageInterdite(name) :" "    const dessine = false ? pageInterdite(name) :" \
  "$MRW"
prouver "une page qui lit deux parties, cachée pour une seule" web/public/v10/app.js \
  "    return !!d && (PARTIES_DES_PAGES[id] || []).some(x => d.cachees.includes(x));" "    return !!d && (PARTIES_DES_PAGES[id] || []).every(x => d.cachees.includes(x));" \
  "$MRW"
prouver "la visite proposée d'une page cachée" web/public/v10/app.js \
  "    if (!pageCachee(name)) appelGuide(name);" "    appelGuide(name);" \
  "$MRW"
prouver "la paie rangée hors de ses parties" web/public/v10/app.js \
  "    paie: ['employees'], salarie: ['employees'], compta: ['ecrituresOD']," "    paie: [], salarie: ['employees'], compta: ['ecrituresOD']," \
  "$MRW"

# ── Brique 102 : les pages en lecture seule (web/v10/lecture-seule.txt) ──
LSW="Samia lit les factures sans les modifier ; Omar lit les clients sans en créer"
prouver "la page en lecture qui ne le dit pas" web/public/v10/app.js \
  "    if (!pageCachee(name)) { if (dessine && typeof dessine.then === 'function')" "    if (false) { if (dessine && typeof dessine.then === 'function')" \
  "$LSW"
prouver "le paiement accepté à l'écran puis perdu" web/public/v10/app.js \
  "        if (enLecture('documents')) return refus(\$('[name=amount]', root), refusLecture('documents'));" "        if (false) return refus(\$('[name=amount]', root), refusLecture('documents'));" \
  "$LSW"
prouver "le brouillon « enregistré » que le serveur ne reçoit pas" web/public/v10/app.js \
  "      if (enLecture('documents')) return refus('#save', refusLecture('documents'));" "      if (false) return refus('#save', refusLecture('documents'));" \
  "$LSW"
prouver "la fiche client acceptée à l'écran puis perdue" web/public/v10/app.js \
  "          if (enLecture('clients')) return refus('#cf input[name=name]', refusLecture('clients'));" "          if (false) return refus('#cf input[name=name]', refusLecture('clients'));" \
  "$LSW"
prouver "la lecture seule prise pour l'écriture" web/public/v10/app.js \
  "  const enLecture = partie => !peutEcrireDossier(partie);" "  const enLecture = partie => false;" \
  "$LSW"

prouver "la fiche client « supprimée » à l'écran, gardée au serveur" web/public/v10/app.js \
  "          if (enLecture('clients')) { toast(refusLecture('clients', 'supprimé'), true); return; }" "          if (false) { toast(refusLecture('clients', 'supprimé'), true); return; }" \
  "$LSW"
prouver "l'achat accepté à l'écran puis perdu" web/public/v10/app.js \
  "      if (enLecture('purchases')) return refus('[data-combo=supplierId] .combo-btn', refusLecture('purchases'));" "      if (false) return refus('[data-combo=supplierId] .combo-btn', refusLecture('purchases'));" \
  "$LSW"

# ── Brique 103 : l'accord au-delà d'une remise (docs/accords.md) ──
AR1="au-delà de la remise permise, le commercial demande l'accord ; il couvre ce taux, pas plus ; seul un responsable règle le seuil"
ARW="Nadia règle la remise permise ; Karim remise au-delà, demande, Nadia accorde depuis la facture, Karim émet"
prouver "l'émission qui ne regarde pas la remise" serveur/v10/dossier.ts \
  "  const accordRemise = type === 'facture' && !ticket ? await controlerRemise(tx, entreprise, cle, doc) : null;" "  const accordRemise = null;" \
  "$AR1"
prouver "la remise au seuil même qui demande l'accord" serveur/v10/accords.ts \
  "  if (!(taux > seuil)) return null;" "  if (!(taux >= seuil)) return null;" \
  "$AR1"
prouver "un accord de remise qui couvre un taux plus fort" serveur/v10/accords.ts \
  "  if (!r || r.statut !== 'accorde' || Number(r.taux) < taux) return null;" "  if (!r || r.statut !== 'accorde') return null;" \
  "$AR1"
prouver "le propriétaire arrêté par la remise" serveur/v10/accords.ts \
  "  if (responsable) return null;" "  if (false) return null;" \
  "$AR1"
prouver "une demande de remise en double" serveur/v10/routes.ts \
  "and statut = 'en_attente' and geste = 'remise' and taux = \$3" "and statut = 'en_attente' and geste = 'remise' and taux = \$3 and false" \
  "$AR1"
prouver "le seuil de remise changé par un commercial en base" base/migrations/0054_accord_remise.sql \
  "  if not (new.collection = '_racine' and new.cle = 'company') then return new; end if;" "  if true then return new; end if;" \
  "$AR1"
prouver "le taux d'une demande réécrit en base" base/migrations/0054_accord_remise.sql \
  "  if (new.taux, new.seuil) is distinct from (old.taux, old.seuil) then" "  if false then" \
  "$AR1"
prouver "la remise au-delà qui ne se dit pas avant" web/public/v10/app.js \
  "      if (isInv && accordsEnLigne() && !estResponsable() && seuilRemise > 0 && tauxRemise > seuilRemise) {" "      if (false) {" \
  "$ARW"
prouver "le seuil de remise qui ne se règle pas à l'écran" web/public/v10/app.js \
  "          \${accordsEnLigne() ? field(lbl('Remise permise sans accord (%)'" "          \${false ? field(lbl('Remise permise sans accord (%)'" \
  "$ARW"
prouver "le seuil de remise perdu à l'enregistrement" web/public/v10/app.js \
  "      data.company.remiseAccordAuDela = Math.min(100, Math.max(0, Number(data.company.remiseAccordAuDela) || 0));" "      data.company.remiseAccordAuDela = 0;" \
  "$ARW"
prouver "une demande de remise lue comme une demande d'encours" web/public/v10/app.js \
  "    const remise = a.geste === 'remise';" "    const remise = false;" \
  "$ARW"

# ── Brique 104 : un prix baissé sous celui du client compte comme une remise (docs/accords.md) ──
RE1="un prix baissé sous celui du client compte comme une remise ; sa liste et son palier sont sa référence"
RE2="une pièce en euros compare au prix du catalogue converti à son taux"
prouver "une ligne hors remise comptée comme remisée" web/public/v10/core.js \
  "      if (!item || l.noDiscount) continue;" "      if (!item) continue;" \
  "$RE1"
prouver "le prix du catalogue pris pour celui du client" web/public/v10/core.js \
  "prixArticlePour(data, item, doc.clientId, doc.date, l.qty).prix, doc, company));" "item.unitPrice, doc, company));" \
  "$RE1"
prouver "le prix en dinars comparé à un prix en euros" web/public/v10/core.js \
  "      const ref = Number(prixDuCatalogue(prixArticlePour(data, item, doc.clientId, doc.date, l.qty).prix, doc, company));" "      const ref = Number(prixArticlePour(data, item, doc.clientId, doc.date, l.qty).prix);" \
  "$RE2"
prouver "la remise globale oubliée sur un prix baissé" web/public/v10/core.js \
  "      const net = (Number(l.unitPrice) || 0) * (1 - globale / 100);" "      const net = (Number(l.unitPrice) || 0);" \
  "$RE1"
prouver "le serveur qui ne voit que la remise globale" serveur/v10/accords.ts \
  "  const taux = Math.round(effective.taux * 100);" "  const taux = Math.round(Number(piece.discountRate) * 100);" \
  "$AR1"
prouver "le serveur qui ignore les listes de prix" serveur/v10/accords.ts \
  "collection in ('clients', 'catalog', 'priceLists')" "collection in ('clients', 'catalog')" \
  "$AR1"
prouver "le refus qui ne nomme pas la ligne baissée" serveur/v10/accords.ts \
  "  throw new Refus(r.ligne ? 'ventes.remise_ligne_accord' : 'ventes.remise_accord', {" "  throw new Refus('ventes.remise_accord', {" \
  "$AR1"
prouver "l'écran qui ne voit que la remise globale" web/public/v10/app.js \
  "      const tauxRemise = effective.taux;" "      const tauxRemise = Number(doc.discountRate) || 0;" \
  "$ARW"

# ── Brique 105 : le téléphone pour de vrai (web/v10/telephone.txt) ──
TEL="les pages du quotidien de la v10, sur un téléphone et un ordinateur : aucune ne défile de côté, rien ne sort de l'écran, et au doigt tout se touche"
prouver "la page qui ne dit pas sa largeur au téléphone" web/public/v10/index.html \
  '  <meta name="viewport" content="width=device-width, initial-scale=1">
' "" \
  "$TEL"
prouver "les premiers pas écrasés à côté de leurs boutons" web/public/plateforme/telephone.css \
  "  .pp-list li { grid-template-columns: 26px minmax(0, 1fr); }
  .pp-list li .pp-go { grid-column: 2; display: flex; flex-wrap: wrap; gap: 8px; }" "" \
  "$TEL"

# ── Brique 106 : toutes les pages du quotidien au vrai téléphone (tests/web/rendu.test.ts) ──
prouver "les en-têtes de colonne trop petits pour le doigt" web/public/plateforme/telephone.css \
  "  th.sortable-h { height: 44px; }
|||gap: 4px; height: 44px; padding: 0 14px;" "|||gap: 4px; padding: 0 14px;" \
  "$TEL"
prouver "le nom d'un client trop petit pour le doigt" web/public/plateforme/telephone.css \
  "  #view a.name { display: inline-flex; align-items: center; min-height: 44px; }" "" \
  "$TEL"

# ── Brique 107 : le parcours du jalon J2, d'un bout à l'autre (tests/web/jalon-j2.test.ts) ──
J2B="acheter, la banque, la déclaration du mois, une coupure du réseau, et le téléphone"
prouver "la facture du mois qui déborde au téléphone" web/public/v10/index.html \
  '  <meta name="viewport" content="width=device-width, initial-scale=1">
' "" \
  "$J2B"

# ── Brique 108 : le compte juste des changements en attente (web/v10/compte-hors-ligne.txt) ──
prouver "un achat né sans sa devise, compté au poste suivant comme un changement de plus" web/public/v10/app.js \
  "      currency: company().currency || 'TND', exchangeRate: 1,
" "" \
  "$J2B"

# ── Brique 109 : la tablette au doigt, et les pages pensées pour un ordinateur qui le disent (web/v10/petit-ecran.txt) ──
prouver "la taille du doigt réservée aux écrans étroits : la caisse sur tablette se mène à la souris" web/public/plateforme/telephone.css \
  "@media (max-width: 760px), (pointer: coarse) {" "@media (max-width: 760px) {" \
  "$TEL"
prouver "une page pensée pour un ordinateur qui ne le dit pas au téléphone" web/public/v10/app.js \
  "    if (!pageCachee(name)) Promise.resolve(dessine).then(() => bandeauOrdinateur(name), () => {});
" "" \
  "$TEL"
prouver "l'avis « pensée pour un ordinateur » posé aussi sur un ordinateur" web/public/v10/app.js \
  "!window.matchMedia('(max-width: 760px)').matches || " "" \
  "$TEL"

# ── Brique 110 : le Cabinet au téléphone (web/v10/cabinet-telephone.txt ; tests/web/cabinet-telephone.test.ts) ──
CTEL="les pages du Cabinet, sur un téléphone et un ordinateur"
prouver "le Cabinet sans la mise en page du téléphone" web/public/v10/cabinet/index.html \
  '  <link rel="stylesheet" href="../../plateforme/telephone.css">
' "" \
  "$CTEL"
prouver "les compteurs du portefeuille écrasés sur une rangée au téléphone" web/public/plateforme/telephone.css \
  "  .stats.rangee { grid-template-columns: repeat(2, minmax(0, 1fr)); }
" "" \
  "$CTEL"
prouver "les mois d'un dossier sur deux rangées de six au téléphone" web/public/plateforme/telephone.css \
  "  .mgrid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
" "" \
  "$CTEL"
prouver "les gestes d'un dossier (consulter, saisir, déclarer) trop petits pour un doigt" web/public/plateforme/telephone.css \
  "  .c-groupes button { min-height: 44px; }
" "" \
  "$CTEL"
prouver "« email à renseigner » trop petit pour un doigt" web/public/plateforme/telephone.css \
  "  .lien-manque { display: inline-flex; align-items: center; min-height: 44px; }
" "" \
  "$CTEL"
prouver "un écran du Cabinet pensé pour un ordinateur qui ne le dit pas au téléphone" web/public/v10/cabinet/app.js \
  "    bandeauOrdinateur(route);
" "" \
  "$CTEL"

# ── Brique 111 : l'accueil selon le rôle (web/v10/accueil-role.txt ; tests/web/menu-role.test.ts) ──
MR="chacun ne voit dans son menu que les pages de son rôle"
prouver "la mise en place de l'entreprise proposée à un membre qui ne la tient pas" web/public/v10/app.js \
  "    if (!estResponsable()) return accueilDuRole();
" "" \
  "$MR"
prouver "« + Nouvelle facture » sur l'accueil de qui ne peut pas écrire une pièce" web/public/v10/app.js \
  "\${peutEcrireDossier('documents') ? \`<button class=\"btn\" id=\"new-devis\">" "\${true ? \`<button class=\"btn\" id=\"new-devis\">" \
  "$MR"
prouver "« À faire » qui mène à une page que le rôle ne montre pas" web/public/v10/app.js \
  "todoMeneACache(x.id) ? '' :" "false ? '' :" \
  "$MR"
prouver "l'accueil de la paie sans bouton principal" web/public/v10/app.js \
  "    const vert = !peutEcrireDossier('documents');" "    const vert = false;" \
  "$MR"

# ── Brique 112 : deux postes sur le même dossier (web/public/plateforme/pont.js ; tests/web/enregistrement-concurrent.test.ts) ──
EC="un enregistrement parti avant la fusion ne supprime pas"
prouver "un objet créé par un autre poste supprimé par une page qui ne l'a jamais eu" web/public/plateforme/pont.js \
  "        if (!base.has(k)) continue;
" "" \
  "$EC"
prouver "un objet changé par un autre poste écrasé avec la révision du serveur" web/public/plateforme/pont.js \
  "revision: base.has(k) ? base.get(k) ?? null : null, contenu: JSON.parse(m.json)" "revision: avant ? avant.revision : null, contenu: JSON.parse(m.json)" \
  "$EC"
prouver "ce que la fusion a donné à la page, qu'elle ne peut plus supprimer" web/public/plateforme/pont.js \
  "      if (avant && avant.json === m.json) base.set(k, avant.revision);
" "" \
  "$EC"
prouver "un objet enregistré qui garde sa révision d'avant (le suivant fait un conflit)" web/public/plateforme/pont.js \
  "vu.set(k, { json: JSON.stringify(c.contenu), rang: c.rang, revision: rev }); base.set(k, rev); }" "vu.set(k, { json: JSON.stringify(c.contenu), rang: c.rang, revision: rev }); }" \
  "$EC"
prouver "le dossier ouvert sans que la page l'ait (rien ne se supprime plus)" web/public/plateforme/pont.js \
  "        adopter();
        await chargerRemises();" "        await chargerRemises();" \
  "$EC"

# ── Brique 113 : le tableau de bord du groupe (serveur/groupe.ts ; web/v10/groupe.txt) ──
GS="les sociétés de la personne, leurs chiffres tirés de leurs livres"
GW="« Le groupe » montre les sociétés côte à côte"
prouver "le chiffre d'affaires du groupe lu à l'envers (débit moins crédit)" serveur/groupe.ts \
  "and e.date_ecriture >= \${mois}::date then l.credit - l.debit end" "and e.date_ecriture >= \${mois}::date then l.debit - l.credit end" \
  "$GS"
prouver "les chiffres d'une société montrés à qui n'en voit pas les livres" serveur/groupe.ts \
  "        if (!d.ok) {" "        if (!d.ok && false) {" \
  "$GS"
prouver "une entreprise d'essai comptée dans le groupe" serveur/groupe.ts \
  "         where not e.essai and socle.perimetre_cabinet(e.id) is null" "         where socle.perimetre_cabinet(e.id) is null" \
  "$GS"
prouver "le total du groupe qui ne garde que la dernière société" serveur/groupe.ts \
  "t.somme[k] += brut[k];" "t.somme[k] = brut[k];" \
  "$GS"
prouver "le groupe absent du menu des entreprises" web/public/v10/app.js \
  "\${bridge.groupe && autres.length ? " "\${false ? " \
  "$GW"

prouver "une réponse de l'API gardée dans le cache du navigateur" serveur/app.ts \
  "if (deLApi(requete.url)) reponse.header('cache-control', 'no-store');" "if (deLApi(requete.url)) void reponse;" \
  "une réponse de l'API dit"

# ── Brique 114 : l'accord au-delà d'une commande fournisseur (docs/accords.md) ──
KC1="au-delà du montant permis, la comptable demande l'accord ; refusé, la commande ne part pas"
KC2="une commande en devise se compte à son taux"
KCW="Ines demande, Nadia accorde depuis son accueil, Ines envoie la commande"
prouver "une commande envoyée au-delà du seuil sans accord" serveur/v10/dossier.ts \
  "    await controlerCommandes(tx, entreprise," "    if (false) await controlerCommandes(tx, entreprise," \
  "$KC1"
prouver "un accord de commande qui couvre un montant plus grand" serveur/v10/accords.ts \
  "  if (r?.statut !== 'accorde' || Number(r.montant) < montant) return null;" "  if (r?.statut !== 'accorde') return null;" \
  "$KC1"
prouver "une commande déjà partie bloquée par le seuil venu après" serveur/v10/accords.ts \
  "    if (envoyee(l.avant) && d.montant <= d.montantDe(l.avant as Json)) continue;" "" \
  "$KC1"
prouver "une commande grossie qui garde son ancien accord" serveur/v10/accords.ts \
  "    if (envoyee(l.avant) && d.montant <= d.montantDe(l.avant as Json)) continue;" "    if (envoyee(l.avant)) continue;" \
  "$KC1"
prouver "une demande de commande en double" serveur/v10/routes.ts \
  "and montant = \$3 and statut = 'en_attente' and geste = 'commande'" "and montant = \$3 and statut = 'en_attente' and geste = 'commande' and false" \
  "$KC1"
prouver "le seuil de commande changé par la comptable en base" base/migrations/0055_accord_commande.sql \
  "  apres := new.contenu -> 'commandeAccordAuDela';" "  return new;" \
  "$KC1"
prouver "une commande en devise comptée sans son taux" web/public/v10/core.js \
  "    return toBase(commande, computeTotals(commande, company).netHT, company);" "    return computeTotals(commande, company).netHT;" \
  "$KC2"
prouver "le propriétaire arrêté par le seuil de commande" serveur/v10/accords.ts \
  "  if (!parties.length || await estResponsable(tx, entreprise)) return;" "  if (!parties.length) return;" \
  "$KC2"
prouver "le seuil de commande qui ne se règle pas à l'écran" web/public/v10/app.js \
  "          \${accordsEnLigne() ? field(lbl(\`Commande fournisseur permise sans accord" "          \${false ? field(lbl(\`Commande fournisseur permise sans accord" \
  "$KCW"
prouver "une commande au-delà qui part sans proposer l'accord" web/public/v10/app.js \
  "      if (besoin) o.status = stored && stored.status !== 'envoyée' ? stored.status : 'brouillon';" "      if (false) o.status = 'brouillon';" \
  "$KCW"
prouver "une commande au-delà qui ne se dit pas avant" web/public/v10/app.js \
  "    return b ? \`<p class=\"small warn-text mt\" id=\"cf-accord-avis\">" "    return false ? \`<p class=\"small warn-text mt\" id=\"cf-accord-avis\">" \
  "$KCW"
prouver "l'avertissement qui reste après l'accord" web/public/v10/app.js \
  "        relu();" "" \
  "$KCW"
prouver "une demande de commande lue comme une demande d'encours sur l'accueil" web/public/v10/app.js \
  ": a.geste === 'commande' ? \`envoyer à" ": false ? \`envoyer à" \
  "$KCW"

# ── Brique 115 : le ticket de caisse encaissé en ligne (docs/caisse.md) ──
TK="le caissier encaisse dans la série des tickets, payé en entier ; le commercial non ; la série des factures ne perd rien"
TKW="Nadia encaisse deux tickets : le serveur les numérote dans leur série, et le bilan les compte"
prouver "la série des tickets que le caissier ne crée pas" base/migrations/0066_serie_par_cle.sql \
  "case when p_prefixe = 'TIC' then array['proprietaire', 'administrateur', 'caissier']" "case when p_prefixe = 'TIC' then array['proprietaire', 'administrateur']" \
  "$TK"
prouver "le caissier qui n'encaisse pas" serveur/caisse/gestes.ts \
  "  { code: 'caisse.ticket.encaisser', module: 'caisse', horsCle: true, ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', caissier: 'oui' } }," "  { code: 'caisse.ticket.encaisser', module: 'caisse', horsCle: true, ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui' } }," \
  "$TK"
prouver "le commercial qui encaisse" serveur/caisse/gestes.ts \
  "  { code: 'caisse.ticket.encaisser', module: 'caisse', horsCle: true, ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', caissier: 'oui' } }," "  { code: 'caisse.ticket.encaisser', module: 'caisse', horsCle: true, ecrit: true,
    roles: { proprietaire: 'oui', administrateur: 'oui', caissier: 'oui', commercial: 'oui' } }," \
  "$TK"
prouver "un ticket encaissé sans être payé en entier" serveur/v10/routes.ts \
  "      if (paye !== depuisTexte(corps.netAPayer, dec)) throw" "      if (false) throw" \
  "$TK"
prouver "un ticket numéroté dans la série des factures" serveur/v10/dossier.ts \
  "  const prefixe = ticket ? 'TIC' : SERIE_V10[type] ?? 'FAC';" "  const prefixe = SERIE_V10[type] ?? 'FAC';" \
  "$TK"
prouver "une facture de l'API numérotée dans la série des tickets" serveur/ventes/pieces.ts \
  "    .\$if(serieVoulue === undefined, (q) => q.where('prefixe', '<>', 'TIC'))" "" \
  "$TK"
prouver "un ticket émis par la route des factures" serveur/v10/dossier.ts \
  "  if (ticket !== (doc.ticket === true)) throw" "  if (ticket && doc.ticket !== true) throw" \
  "$TK"
prouver "un ticket encaissé sans son paiement" serveur/v10/routes.ts \
  "      const avecPaiement = { ...r.contenu, payments: paiements," "      const avecPaiement = { ...r.contenu, payments: []," \
  "$TK"
prouver "un passant vendu sans le client du comptoir" serveur/v10/dossier.ts \
  "  const comptoir = (ticket || retour) && !doc.clientId;" "  const comptoir = retour && !doc.clientId;" \
  "$TK"
prouver "la caisse qui refuse encore d'encaisser en ligne" web/public/v10/app.js \
  "      if (bridge.encaisser) {" "      if (bridge.emettre) { toast('La caisse n\\'est pas encore dans la version en ligne de SkanFact : rien n\\'a été vendu.', true); return; }
      if (bridge.encaisser) {" \
  "$TKW"
prouver "le numéro du poste gardé au lieu de celui du serveur" web/public/v10/app.js \
  "        bridge.encaisser(t, C.computeTotals(t, company()).netToPay, code ? { responsable: code } : undefined).then(e => {
          data.documents.push(e);" "        bridge.encaisser(t, C.computeTotals(t, company()).netToPay, code ? { responsable: code } : undefined).then(e => {
          e.number = 'TIC-0000-999'; data.documents.push(e);" \
  "$TKW"

# ── Brique 116 : la session de caisse, son appareil et son Z (docs/caisse.md) ──
CS="fermée rien ne s'encaisse ; ouverte sur un appareil, lui seul la tient"
CSW="Nadia encaisse deux tickets : le serveur les numérote dans leur série, et le bilan les compte"
prouver "un ticket encaissé caisse fermée" serveur/v10/routes.ts \
  "        if (!s) throw new Refus('caisse.fermee', { bouton: 'caisse.session.ouvrir' });" "" \
  "$CS"
prouver "un ticket encaissé depuis un autre appareil" serveur/v10/routes.ts \
  "        if (s.appareil !== qui.appareil) throw new Refus('caisse.ouverte_ailleurs'" "        if (false) throw new Refus('caisse.ouverte_ailleurs'" \
  "$CS"
prouver "une caisse ouverte deux fois" serveur/caisse/routes.ts \
  "      if (deja) {" "      if (false) {" \
  "$CS"
prouver "un ticket hors de sa session" serveur/caisse/routes.ts \
  "from caisse.ticket t join ventes.piece p on p.id = t.piece where t.session = \$1\`, [session])).rows[0] as" "from caisse.ticket t join ventes.piece p on p.id = t.piece where t.entreprise = (select entreprise from caisse.session where id = \$1)\`, [session])).rows[0] as" \
  "$CS"
prouver "un tiroir attendu sans son fond" serveur/caisse/routes.ts \
  "attendu: fond + especes," "attendu: especes," \
  "$CS"
prouver "un Z qui compte les tickets des autres sessions" serveur/caisse/routes.ts \
  "    from caisse.ticket t join ventes.piece p on p.id = t.piece where t.session = \$1\`, [session])).rows[0] as" "    from caisse.ticket t join ventes.piece p on p.id = t.piece where \$1::uuid is not null\`, [session])).rows[0] as" \
  "$CS"
prouver "un écart compté à l'envers" serveur/caisse/routes.ts \
  "ecart: texte(compte - z0.attendu)," "ecart: texte(z0.attendu - compte)," \
  "$CS"
prouver "un Z réécrit en base" base/migrations/0057_caisse.sql \
  "  if old.fermee_le is not null then" "  if false then" \
  "$CS"
prouver "une caisse fermée par un caissier sur un autre appareil" serveur/caisse/routes.ts \
  "      if (s.appareil !== qui.appareil && !responsable) throw" "      if (false) throw" \
  "$CS"
prouver "un fond tapé avec une virgule illisible" serveur/caisse/routes.ts \
  "  const v = valeur.replace(/\\s/g, '').replace(',', '.');" "  const v = valeur.replace(/\\s/g, '');" \
  "$CS"
# (La caisse tactile, 05/10/2026) Fermée, l'écran de vente laisse la place à la carte « La caisse est fermée » : rien ne
# s'y vend, elle s'ouvre d'abord.
prouver "la caisse fermée qui laisse encaisser à l'écran" web/public/v10/app.js \
  "      if (caisseEtat && (!ss || !ss.ici)) { s.ecran = 'vente'; return drawFermee(); }" "      if (false) { s.ecran = 'vente'; return drawFermee(); }" \
  "$CSW"
prouver "la page Caisse muette sur sa session" web/public/v10/app.js \
  "    if (bridge.caisse) dessinerSession();" "" \
  "$CSW"
prouver "le Z qui montre le fond au lieu de l'attendu" web/public/v10/app.js \
  "\`<b>\${h(argentCaisse(z.attendu))}</b>\`" "\`<b>\${h(argentCaisse(z.fond))}</b>\`" \
  "$CSW"

# ── L'ordre du dossier reçu (01/10/2026 ; docs/pont-v10.md § 4 ter) ──
prouver "le dossier rendu dans l'ordre de la langue de la base" serveur/v10/dossier.ts \
  ".orderBy(sql\`collection <> '_racine'\`).orderBy(sql\`collection collate \"C\"\`)" ".orderBy('collection')" \
  "la racine d'abord, puis les listes, quelle que soit la langue de la base"
prouver "une liste vide de la racine qui recouvre ses objets" web/public/plateforme/pont.js \
  "    for (const o of objets) if (o.collection === '_racine') data[o.cle] = decoder(o.contenu);
    for (const o of objets) {
      if (o.collection === '_racine') continue;
      if (!Array.isArray(data[o.collection])) data[o.collection] = [];" "    for (const o of objets) {
      if (o.collection === '_racine') { data[o.cle] = decoder(o.contenu); continue; }
      if (!Array.isArray(data[o.collection])) data[o.collection] = [];" \
  "une liste vide restée à la racine, reçue après ses objets, ne les efface pas"

# ── Supprimer un brouillon : les siens (brique 117, 01/10/2026 ; docs/droits-dossier.md) ──
BA="un commercial ne supprime que ses brouillons ; la propriétaire, tous ; une pièce sans auteur connu, un responsable seulement"
BAW="Lina ne supprime pas le devis de Karim, et le sien oui"
prouver "le brouillon d'un autre supprimé sans dire son auteur" serveur/v10/dossier.ts \
  "  if (!options.serveur) await verifierAuteurs(tx, entreprise, utilisateur, changements, actuels);" "" \
  "$BA"
prouver "le propriétaire qui ne supprime pas le brouillon d'un commercial" serveur/v10/dossier.ts \
  "  if ((await tx.query(\`select socle.mes_roles(\$1) && array['proprietaire', 'administrateur'] r\`, [entreprise])).rows[0]?.r) return;" "" \
  "$BA"
prouver "l'auteur oublié à la création d'une pièce" serveur/v10/dossier.ts \
  "rang: c.rang, contenu: JSON.stringify(c.contenu), modifie_par: utilisateur, cree_par: utilisateur })" "rang: c.rang, contenu: JSON.stringify(c.contenu), modifie_par: utilisateur })" \
  "$BA"
prouver "la base qui laisse supprimer le brouillon d'un autre" base/migrations/0058_auteur.sql \
  "     and old.cree_par is distinct from socle.moi()" "     and false" \
  "$BA"
prouver "l'écran qui croit siennes les pièces de Lina" serveur/v10/routes.ts \
  "and d.cree_par is distinct from \$3\`" "and \$3::uuid is not null\`" \
  "$BA"
prouver "l'écran qui n'apprend pas qui a fait les pièces" web/public/plateforme/pont.js \
  "    autrui = r.autrui || {};" "" \
  "$BAW"
prouver "« Supprimer » qui pose la question sur le brouillon d'un autre" web/public/v10/app.js \
  "      if (auteurAutre('documents', doc.id) !== null) { toast(refusAuteur(auteurAutre('documents', doc.id), doc.number || 'Ce brouillon'), true); return; }" "" \
  "$BAW"

# ── Léger sur une connexion lente (brique 118, 01/10/2026 ; docs/leger.md) ──
LG3="S3 : les écrans et les réponses de l'API partent compressés ; un petit envoi, tel quel ; un écran à empreinte se garde"
LG12="S1 et S2 : la première ouverture et la suivante, sur une connexion lente"
prouver "les écrans de la v10 pris pour l'API (jamais gardés)" serveur/app.ts \
  "const deLApi = (url: string) => url === VERSION || url.startsWith(\`\${VERSION}/\`) || url.startsWith(\`\${VERSION}?\`);" "const deLApi = (url: string) => url.startsWith(VERSION);" \
  "$LG3"
prouver "une réponse de l'API jamais compressée" serveur/app.ts \
  "    reponse.header('content-encoding', encodage).removeHeader('content-length');
    return compresser(brut, encodage);" "    return corps;" \
  "$LG3"
prouver "un petit envoi compressé quand même" serveur/app.ts \
  "brut.length > SEUIL_COMPRESSION ? choisirEncodage" "brut.length > 0 ? choisirEncodage" \
  "$LG3"
prouver "gzip choisi quand le navigateur connaît brotli" serveur/compression.ts \
  "  if (permis.has('br')) return 'br';
" "" \
  "$LG3"
prouver "les écrans envoyés sans compression" serveur/principal.ts \
  "    if (encodage) return reponse.header('content-encoding', encodage).send(ecrans.compresse(f, encodage));
" "" \
  "$LG3"
prouver "une page sans l'empreinte de ses fichiers" serveur/ecrans.ts \
  "      return \`\${attribut}=\"\${adresse}?v=\${lire(cible).empreinte}\"\`;" "      return tout;" \
  "$LG3"
prouver "un fichier à empreinte qui ne se garde pas" serveur/principal.ts \
  " || new URL(requete.url, 'http://x').searchParams.get('v') === f.empreinte;" ";" \
  "$LG3"
prouver "un fichier inchangé renvoyé entier" serveur/principal.ts \
  "    if (dejaGarde(requete.headers['if-none-match'], etag)) return reponse.code(304).send();
" "" \
  "$LG3"
prouver "les scripts demandés un par un" serveur/ecrans.ts \
  "    return versionnee.slice(0, apres) + marque + annonces + versionnee.slice(apres);" "    return versionnee.slice(0, apres) + marque + versionnee.slice(apres);" \
  "$LG3"
prouver "les écrans d'entrée jamais gardés à l'installation" web/public/sw.js \
  "  await c.put(page, r);
  await ranger(c, page, html);
" "" \
  "$HL1"
prouver "le Cabinet gardé chez qui ne l'ouvre jamais" web/public/sw.js \
  "const ENTREES = ['/'];" "const ENTREES = ['/', '/v10/cabinet/'];" \
  "$LG12"
prouver "la page qui installe jamais gardée pour le hors-ligne" web/public/sw.js \
  "      if (!pasPourMoi(u)) pages.add(u.pathname);" "" \
  "$LG12"

# ── Les écrans sans leurs commentaires (L6, 05/10/2026 ; docs/leger.md) ──
LG6A="L6 : un commentaire part, rien d'autre : ni deux mots collés, ni une ligne déplacée, ni ce qui lui ressemble dans une chaîne"
LG6B="L6 : nos écrans partent sans un commentaire, et c'est le même programme que le dépôt, ligne pour ligne"
prouver "les écrans envoyés avec leurs commentaires" web/vite.config.ts \
  "    writeBundle(sortie) { if (sortie.dir) allegerLesEcrans(sortie.dir); }," "    writeBundle() {}," \
  "$LG6B"
prouver "la première ouverture avec les commentaires, au-delà du seuil" web/vite.config.ts \
  "    writeBundle(sortie) { if (sortie.dir) allegerLesEcrans(sortie.dir); }," "    writeBundle() {}," \
  "$LG12"
prouver "un bloc de commentaire qui déplace les lignes (et change un « return »)" web/alleger.ts \
  "morceaux.push(lignes ? '\n'.repeat(lignes) : finDeLigne ? '' : ' ');" "morceaux.push(finDeLigne ? '' : ' ');" \
  "$LG6A"
prouver "deux mots collés là où était un commentaire" web/alleger.ts \
  "finDeLigne ? '' : ' '" "''" \
  "$LG6A"
prouver "un « /* » dans une chaîne de style pris pour un commentaire" web/alleger.ts \
  "} else if (c === '\"' || c === '\\'') {" "} else if (false) {" \
  "$LG6A"
prouver "une adresse de style sans guillemets coupée à son « /* »" web/alleger.ts \
  "} else if (/^url\(\s*[^\s\"')]/i.test(code.slice(i, i + 64)) && !/[\w-]/.test(code[i - 1] ?? '')) {" "} else if (false) {" \
  "$LG6A"
prouver "un caractère échappé du style pris pour un début de commentaire" web/alleger.ts \
  "    if (c === '\\\\') {" "    if (false) {" \
  "$LG6A"
prouver "un script illisible envoyé quand même" web/alleger.ts \
  "if (lu.errors.length) throw" "if (lu.errors.length < 0) throw" \
  "$LG6A"
prouver "le code d'un tiers privé de sa licence" web/alleger.ts \
  "export const DOSSIERS_ALLEGES = ['v10', 'plateforme', 'espace'];" "export const DOSSIERS_ALLEGES = ['v10', 'plateforme', 'espace', 'tiers'];" \
  "$LG6B"
prouver "un écran réécrit en passant (=== devenu ==)" web/alleger.ts \
  "    morceaux.push(code.slice(pos, c.start).replace(/[ \t]+\$/, ''));" "    morceaux.push(code.slice(pos, c.start).replace(/[ \t]+\$/, '').replace('===', '=='));" \
  "$LG6B"
prouver "une feuille de style qui perd l'accolade posée avant un commentaire" web/alleger.ts \
  "  return sans(code, trouves);" "  return sans(code.replace(/\}(?=[ \t]*\/\*)/g, ' '), trouves);" \
  "$LG6B"

# ── Relire le dossier par différence (brique 119, 01/10/2026 ; docs/leger.md, S4) ──
RL="seul ce qui a changé repart, et ce qui a été retiré ; une écriture en cours n'est jamais perdue ; sinon tout repart"
RLW="rouvrir ne fait repartir que ce qui a changé, et l'écran le montre"
prouver "la marque prise après les écritures en cours (une écriture perdue)" serveur/v10/dossier.ts \
  "select pg_snapshot_xmin(s)::text marque" "select pg_snapshot_xmax(s)::text marque" \
  "$RL"
prouver "un objet retiré que la différence ne dit pas" base/migrations/0059_relecture.sql \
  "  insert into socle.dossier_v10_retire (entreprise, collection, cle) values (old.entreprise, old.collection, old.cle)
    on conflict (entreprise, collection, cle) do update set xid = pg_current_xact_id(), retire_le = now();" "  null;" \
  "$RL"
prouver "un objet recréé encore dit retiré" base/migrations/0059_relecture.sql \
  "  delete from socle.dossier_v10_retire where entreprise = new.entreprise and collection = new.collection and cle = new.cle;" "  null;" \
  "$RL"
prouver "un objet modifié qui ne repart pas" base/migrations/0059_relecture.sql \
  "  new.xid := pg_current_xact_id();" "  null;" \
  "$RL"
prouver "une copie faite avec d'autres rôles complétée quand même" serveur/v10/routes.ts \
  "query.profil === profil && " "" \
  "$RL"
prouver "une marque de l'avenir acceptée" serveur/v10/routes.ts \
  " && BigInt(depuis) <= BigInt(marque)" "" \
  "$RL"
prouver "une copie d'une autre base complétée quand même" serveur/v10/routes.ts \
  "      const profil = \`\${base}/\${qui.utilisateur}/\${[...roles].sort().join(',')}\`;" "      const profil = \`00000000-0000-0000-0000-000000000000/\${qui.utilisateur}/\${[...roles].sort().join(',')}\`;" \
  "$RL"
prouver "un numéro d'une autre base dans une différence" serveur/v10/dossier.ts \
  "and xid >= \$2::xid8 and xid < \$3::xid8\`" "and xid >= \$2::xid8 and \$3::text is not null\`" \
  "$RL"
prouver "la différence qui montre ce que le rôle ne voit pas" serveur/v10/routes.ts \
  "        const f = filtrer(roles, d.objets);" "        const f = { ...filtrer(roles, d.objets), objets: d.objets };" \
  "$RL"
prouver "les retraits d'une partie cachée dits au rôle" serveur/v10/routes.ts \
  "retires: filtrer(roles, d.retires).objets" "retires: d.retires" \
  "$RL"
prouver "un client retiré qui reste à l'écran" web/public/plateforme/pont.js \
  "      for (const x of r.retires || []) tous.delete(\`\${x.collection}\\u0000\${x.cle}\`);
" "" \
  "$RLW"
prouver "le poste qui ne demande jamais la différence" web/public/plateforme/pont.js \
  "    const depuis = copie && copie.marque && copie.profil ?" "    const depuis = false ?" \
  "$RLW"
prouver "la copie qui oublie sa marque" web/public/plateforme/pont.js \
  "marque: marqueLue, profil: profilLu," "" \
  "$RLW"

# ── La caisse sans réseau (brique 120, 01/10/2026 ; docs/caisse.md, H1 à H4) ──
CHS="le poste numérote et chaîne ; au retour, ses tickets s'émettent dans l'ordre ; un écart devient une alerte, jamais une correction"
CHW="sans réseau, le poste numérote et garde ; au retour, les tickets partent dans l'ordre, sous les mêmes numéros"
prouver "un numéro imprimé différent de la série, tu" serveur/v10/routes.ts \
  "        if (p.numero !== r.numero) await alerter('numero');" "" \
  "$CHS"
prouver "une chaîne de tickets cassée, tue" serveur/v10/routes.ts \
  "        if (p.precedente !== derniere) await alerter('chaine', { attendue: derniere, recue: p.precedente });" "" \
  "$CHS"
prouver "une empreinte de ticket qui ne se recalcule pas, tue" serveur/v10/routes.ts \
  "        if (empreinteDuPoste(p.precedente, ticketDuPoste(doc, corps.netAPayer, p.numero, p.encaisseLe)) !== p.empreinte) await alerter('empreinte');" "" \
  "$CHS"
prouver "un ticket arrivé après le Z, tu" serveur/v10/routes.ts \
  "        if (session.ferme) await alerter('apres_fermeture');" "" \
  "$CHS"
prouver "un ticket envoyé deux fois, compté deux fois" serveur/v10/routes.ts \
  "        if (deja) return { corps:" "        if (false) return { corps:" \
  "$CHS"
prouver "les tickets d'une caisse remis par un autre appareil" serveur/v10/routes.ts \
  "        if (s.appareil !== qui.appareil) throw new Refus('caisse.pas_ce_poste');" "" \
  "$CHS"
prouver "un ticket sans réseau refusé parce que sa session est fermée" serveur/v10/routes.ts \
  "      if (p?.horsLigne) {" "      if (false) {" \
  "$CHS"
prouver "les alertes de caisse montrées au caissier" serveur/caisse/routes.ts \
  "const alertes = responsable ? (await" "const alertes = true ? (await" \
  "$CHS"
prouver "le poste qui ne connaît pas la fin de sa chaîne" serveur/caisse/routes.ts \
  "    order by cree_le desc, piece desc limit 1\`, [s.id])).rows[0]?.empreinte_poste ?? PREMIERE);" "    order by cree_le desc, piece desc limit 1\`, [s.id])).rows[0]?.aucune ?? PREMIERE);" \
  "$CHS"
prouver "la série des tickets inconnue du poste avant le premier ticket" serveur/caisse/routes.ts \
  "      await tx.query(\`select ventes.serie_v10(\$1, 'facture', 'TIC')\`, [ent]);
" "" \
  "$CHS"
prouver "le numéro écrit autrement que la série (serveur)" serveur/caisse/chaine.ts \
  "  const chiffres = String(numero).padStart(largeur, '0');" "  const chiffres = String(numero);" \
  "$CHS"
prouver "le numéro écrit autrement que la série (poste)" web/public/plateforme/pont.js \
  "replace(/\\{N(:[1-9])?\\}/, String(n).padStart(largeur, '0'));" "replace(/\\{N(:[1-9])?\\}/, String(n));" \
  "$CHW"
prouver "un ticket écrit autrement par le poste et par le serveur" web/public/plateforme/pont.js \
  "lignes: doc.lines ?? [], netAPayer: net," "lignes: doc.lines ?? [], netAPayer: Number(net)," \
  "$CHW"
prouver "les tickets remis dans le désordre" web/public/plateforme/pont.js \
  "        const t = fileTickets[0];" "        const t = fileTickets[fileTickets.length - 1];" \
  "$CHW"
prouver "la caisse qui encaisse sans réseau au-delà de 7 jours" web/public/plateforme/pont.js \
  "            : poste.limiteCaisse();" "            : null;" \
  "$CHW"
prouver "un ticket sans réseau qui repart avec le dossier" web/public/plateforme/pont.js \
  "      if (m.collection === 'documents' && m.json.includes('\"caisseHorsLigne\":true')) continue;
" "" \
  "$CHW"
prouver "les tickets qui attendent absents de la page rouverte" web/public/plateforme/pont.js \
  "    for (const t of fileTickets) if (!ids.has(t.document.id)) data.documents.push(" "    for (const t of []) if (!ids.has(t.document.id)) data.documents.push(" \
  "$CHW"
prouver "la page Caisse muette sans réseau" web/public/v10/app.js \
  "const hl = e && e.horsLigne && bridge.caisseSansReseau ? bridge.caisseSansReseau() : null;" "const hl = null;" \
  "$CHW"
prouver "la page Caisse qui dit encore « Sans réseau » au retour" web/public/v10/app.js \
  "  window.addEventListener('skanfact-tickets-remis', () => { if (\$('#cs-session')) dessinerSession(); });
" "" \
  "$CHW"
prouver "les alertes de caisse jamais montrées" web/public/v10/app.js \
  "    if ((caisseEtat.alertes || []).length) el.insertAdjacentHTML('beforeend', alertesCaisse(caisseEtat.alertes));
" "" \
  "$CHW"

# ── Le caissier à l'écran (brique 121, 01/10/2026 ; docs/caisse.md) ──
CW="Sami ouvre la caisse, vend, voit son ticket et pas ceux de Nadia, et ferme la caisse"
prouver "le caissier qui ne retrouve pas ses tickets" serveur/v10/droits.ts \
  "  return [...visibles, ...tous.filter((o) => o.collection === 'documents' && siens.has(o.cle))];" "  return visibles;" \
  "$CW"
prouver "le caissier qui lit les tickets des autres" serveur/v10/droits.ts \
  "      and cree_par = \$2 and contenu ->> 'ticket' = 'true')" "      and \$2::uuid is not null and contenu ->> 'ticket' = 'true')" \
  "$CW"
prouver "la page Caisse absente du menu du caissier" web/public/v10/app.js \
  "    if (d && id === 'caisse' && d.caisse) return false;
" "" \
  "$CW"
prouver "le serveur qui ne dit pas qui tient une caisse" serveur/v10/droits.ts \
  "    caisse: permet(roles, 'caisse.ticket.encaisser', true) } };" "    caisse: false } };" \
  "$CW"
prouver "le caissier qui ne sait pas où vont les espèces" serveur/v10/droits.ts \
  "  accounts: R('tresorerie.comptes.voir', 'tresorerie.comptes.modifier')," "  accounts: R('tresorerie.voir', 'tresorerie.comptes.modifier')," \
  "$CW"
prouver "la caisse dite « en lecture seule » à qui la tient" web/public/v10/app.js \
  "    if (name === 'caisse' && (bridge.droitsDossier() || {}).caisse) return;
" "" \
  "$CW"
prouver "le poste qui oublie qu'il tient une caisse" web/public/plateforme/pont.js \
  "    tientCaisse = !!(d && d.caisse === true);
" "" \
  "$CW"

# ── Un seul tiroir, compté à l'aveugle (brique 122, 01/10/2026 ; docs/caisse.md) ──
prouver "le bilan qui dit le tiroir pendant la session (le compte n'est plus à l'aveugle)" web/public/v10/app.js \
  "      if (!caisseEtat || caisseEtat.session) return 'Le tiroir se compte à la fermeture (Z), sans voir ce qu\\'il devrait contenir.';
" "" \
  "$CW"
prouver "sans réseau, le bilan qui redit le tiroir au poste qui tient la caisse" web/public/v10/app.js \
  "(caisseEtat || (bridge.caisseSansReseau && bridge.caisseSansReseau()))" "caisseEtat" \
  "$CHW"
prouver "le bilan après le Z qui ne dit pas le même tiroir que le Z" web/public/v10/app.js \
  "      if (z && jourTunis(z.fermeeLe) === b.jour) return" "      if (false) return" \
  "$CW"
prouver "le bilan imprimé qui dit le tiroir pendant la session" web/public/v10/app.js \
  "C.bilanCaisseHtml(bilanAImprimer(C.bilanCaisse(data, company(), s.jour)), company())" "C.bilanCaisseHtml(C.bilanCaisse(data, company(), s.jour), company())" \
  "$CW"
prouver "le bilan dessiné avant la session lue, jamais redit" web/public/v10/app.js \
  "    if (\$('#cs-tiroir') && dernierBilan) \$('#cs-tiroir').innerHTML = sousTiroir(dernierBilan.b, dernierBilan.cur);
" "" \
  "$CW"

# ── Changer de caissier (brique 123, 01/10/2026 ; docs/caisse.md, R1 à R5) ──
CR="Leila prend la caisse de Sami avec son code ; sa session ne sert qu'à la caisse ; un code faux attend, sans bloquer"
CRW="Leila pose son code, puis prend la caisse de Sami ; ses tickets portent son nom"
prouver "une session de caisse qui ouvre le compte de la personne" serveur/app.ts \
  "          if (!GESTES.has(r.geste) && r.geste !== 'compte.deconnecter') return envoyer(403, { motif: motif('porte.session_de_caisse'), qui: [], bouton: 'session_de_caisse' });
" "" \
  "$CR"
prouver "une session de caisse qui ouvre une autre entreprise de la personne" serveur/app.ts \
  "          if (GESTES.has(r.geste) && params.entreprise !== qui.caisseDe) return envoyer(404, { motif: motif('commun.introuvable') });
" "" \
  "$CR"
prouver "le relais qui ouvre une session pour tout le compte" base/migrations/0062_relais_caissier.sql \
  "interval '12 hours', p_entreprise)" "interval '12 hours', null)" \
  "$CR"
prouver "le relais qui laisse la session du précédent ouverte" base/migrations/0062_relais_caissier.sql \
  "  update socle.session set fermee_le = p_maintenant where id = p_session;
" "" \
  "$CR"
prouver "un administrateur qui prend la caisse par quatre chiffres" base/migrations/0062_relais_caissier.sql \
  " and not (m.roles && array['proprietaire', 'administrateur', 'paie']::text[]))" ")" \
  "$CR"
prouver "le relais depuis un autre appareil que celui de la caisse" serveur/caisse/routes.ts \
  "      if (!poste) throw new Refus('caisse.relais_pas_ce_poste');
" "" \
  "$CR"
prouver "un code faux qui passe" serveur/caisse/routes.ts \
  "!/^[0-9]{4}\$/.test(corps.code) || !await correspond(e, corps.code)" "!/^[0-9]{4}\$/.test(corps.code)" \
  "$CR"
prouver "cinq codes faux, et le sixième essai n'attend pas" serveur/caisse/routes.ts \
  "      if (attente) return { statut: 403, corps: { motif: attenteLisible(attente, maintenant), qui: [], bouton: null } };
" "" \
  "$CR"
prouver "un code qui descend (9876) accepté" serveur/caisse/routes.ts \
  " || pas.every((p) => p === -1)" "" \
  "$CR"
prouver "la relecture par différence qui rend au suivant ce que le précédent lisait" serveur/v10/routes.ts \
  "      const profil = \`\${base}/\${qui.utilisateur}/\${[...roles].sort().join(',')}\`;" "      const profil = \`\${base}/\${[...roles].sort().join(',')}\`;" \
  "$CR"
prouver "« Changer de caissier » sur un appareil qui ne tient pas la caisse" serveur/caisse/routes.ts \
  "const posteDeCaisse = qui.appareil ? Boolean(" "const posteDeCaisse = qui.appareil ? true || Boolean(" \
  "$CRW"
prouver "le relais qui laisse partir les tickets en attente sous le nom du suivant" web/public/plateforme/pont.js \
  "      if (fileTickets.length || attenteGardee || enCours) {" "      if (false) {" \
  "$CHW"

prouver "le ticket en ligne que la copie du poste n'a pas encore quand l'écran le dit" web/public/plateforme/pont.js \
  "        await garderLaCopieMaintenant();
        return decoder(r.contenu);" "        garderLaCopie();
        return decoder(r.contenu);" \
  "$CHW"

# ── Le retour à la caisse, avec le code d'un responsable (brique 124, 01/10/2026 ; docs/caisse.md, T1 à T5) ──
CT="Sami rend un pain avec le code de Nadia ; jamais plus que vendu ; le Z compte l'argent rendu"
CTW="Sami rend un pain avec le code de Nadia ; le bilan et le Z comptent l'argent rendu"
prouver "un caissier qui rend sans le code d'un responsable" serveur/caisse/retour.ts \
  "      if (!roles.some((r) => r === 'proprietaire' || r === 'administrateur')) {" "      if (false) {" \
  "$CT"
prouver "un code de responsable faux qui passe" serveur/caisse/retour.ts \
  "!/^[0-9]{4}\$/.test(rsp.code) || !await correspond(e, rsp.code)" "!/^[0-9]{4}\$/.test(rsp.code)" \
  "$CT"
prouver "cinq codes de responsable faux, et le sixième n'attend pas" serveur/caisse/retour.ts \
  "  if (attente) return { reponse: { statut: 403, corps: { motif: attenteLisible(attente, maintenant), qui: [], bouton: null } } };
" "" \
  "$CT"
prouver "rendre plus que le ticket n'a vendu" serveur/caisse/retour.ts \
  "        if ((deja.get(i) ?? 0n) + (dansCetAvoir.get(i) ?? 0n) > quantite(t.qty)) {" "        if (false) {" \
  "$CT"
prouver "rendre un article à un autre prix que celui du ticket" serveur/caisse/retour.ts \
  " || !meme(l.unitPrice, t.unitPrice)" "" \
  "$CT"
prouver "l'argent rendu qui n'est pas le net de l'avoir" serveur/caisse/retour.ts \
  "if (rendu !== net || p.date" "if (p.date" \
  "$CT"
prouver "rendre depuis un autre appareil que celui qui tient la caisse" serveur/caisse/retour.ts \
  "      if (s.appareil !== qui.appareil) throw new Refus('caisse.ouverte_ailleurs_retour'" "      if (false) throw new Refus('caisse.ouverte_ailleurs_retour'" \
  "$CT"
prouver "l'avoir du retour qui ne porte pas le nom du responsable" serveur/caisse/retour.ts \
  "retourCaisse: { faitPar, ...(approuvePar ? { approuvePar: approuvePar.nom } : {}) }" "retourCaisse: { faitPar }" \
  "$CT"
prouver "un ancien administrateur qui approuve encore à la caisse" base/migrations/0063_retour_caisse.sql \
  "                    and m.roles && array['proprietaire', 'administrateur']::text[])" "                    )" \
  "$CT"
prouver "le Z qui compte l'argent rendu avec les encaissements" serveur/caisse/routes.ts \
  "    where t.session = \$1 and r.montant > 0 group by r.mode" "    where t.session = \$1 group by r.mode" \
  "$CT"
prouver "le Z qui oublie l'argent rendu dans le tiroir" serveur/caisse/routes.ts \
  "  const especes = (parMode.especes ?? 0n) - (rendu.especes ?? 0n);" "  const especes = parMode.especes ?? 0n;" \
  "$CT"
prouver "le retour d'un ticket au comptoir, sans client, refusé" serveur/v10/dossier.ts \
  "  const comptoir = (ticket || retour) && !doc.clientId;" "  const comptoir = ticket && !doc.clientId;" \
  "$CT"
prouver "le caissier qui ne voit pas les retours faits sur ses tickets" serveur/v10/droits.ts \
  "      and contenu ->> 'creditOf' in (select cle from tickets)\`" "      and false\`" \
  "$CT"
prouver "le retour à l'écran qui ne passe pas par le serveur" web/public/v10/app.js \
  "        if (bridge.rendreTicket) { void rendreParLeServeur(doc, r, root, close); return; }
" "" \
  "$CTW"
prouver "« Mon code de responsable » absent pour la propriétaire" web/public/v10/app.js \
  "      d.responsable && bridge.poserCodeResponsable ? '<button" "      false ? '<button" \
  "$CTW"
prouver "le Z à l'écran qui ne dit pas l'argent rendu" web/public/v10/app.js \
  '${Object.entries(z.rendu || {}).map(' '${Object.entries({}).map(' \
  "$CTW"

prouver "« Mon code de caisse » qui pose un code de responsable (l'événement du clic pris pour un drapeau)" web/public/v10/app.js \
  "\$('#cs-mon-code').onclick = () => monCodeDeCaisse(false);" "\$('#cs-mon-code').onclick = monCodeDeCaisse;" \
  "$CRW"

# ── La remise à la caisse (brique 125, 01/10/2026 ; docs/caisse.md, M1 à M4) ──
CM="au-delà du plafond (0 % par défaut), le code d'un responsable ; en dessous, rien ; sans réseau, une alerte"
CMW="Sami remise 10 % avec le code de Nadia ; sous le plafond qu'elle règle, sans code"
prouver "une remise sous le plafond qui demande quand même un code" serveur/caisse/remise.ts \
  "  if (taux <= plafond) return null;" "  if (true) return null;" \
  "$CM"
prouver "le plafond par défaut qui laisse toute remise sans code" serveur/caisse/remise.ts \
  "fiche === '' ? 0n : centiemes(fiche)" "fiche === '' ? 10000n : centiemes(fiche)" \
  "$CM"
prouver "un caissier qui remise au-delà du plafond sans responsable" serveur/v10/routes.ts \
  "      if (remise && !(await estResponsable(tx, ent))) {" "      if (false) {" \
  "$CM"
prouver "le ticket remisé qui ne porte pas le nom du responsable" serveur/v10/routes.ts \
  "{ ...doc, payments: [], ...(remiseCaisse ? { remiseCaisse } : {}) }" "{ ...doc, payments: [] }" \
  "$CM"
prouver "le ticket remisé sans réseau qui ne s'enregistre pas" serveur/v10/routes.ts \
  "        if (p?.horsLigne) remiseSansAccord = true;
        else {" "        {" \
  "$CM"
prouver "le ticket remisé sans réseau, sans code, qui ne se dit pas" serveur/v10/routes.ts \
  "        if (remiseSansAccord && remise) await alerter('remise', remise);
" "" \
  "$CM"
prouver "le plafond de la caisse changé par un caissier en base" base/migrations/0064_remise_caisse.sql \
  "  if apres is distinct from avant and socle.moi() is not null" "  if false and apres is distinct from avant and socle.moi() is not null" \
  "$CM"
prouver "le panier qui ne compte pas sa remise" web/public/v10/core.js \
  "discountRate: tauxRemise(o.remise)," "discountRate: 0," \
  "$CMW"
prouver "une remise de 120 % qui s'encaisse" web/public/v10/core.js \
  "    if (!(r >= 0 && r <= 100)) return 'La remise est un pourcentage entre 0 et 100 : tape-la comme 10 ou 7,5.';
" "" \
  "$CMW"
prouver "le ticket qui part sans sa remise" web/public/v10/core.js \
  "discountRate: tauxRemise(o.remise) || 0," "discountRate: 0," \
  "$CMW"
prouver "« Encaisser » qui ne demande pas le code avant le geste" web/public/v10/app.js \
  "        if (remise > plafond && !responsable && !b.dataset.code) {" "        if (false) {" \
  "$CMW"
prouver "le code du responsable qui ne part pas avec le ticket" web/public/plateforme/pont.js \
  "...(fait ? { poste: fait.poste } : {}), ...(responsable ? { responsable } : {}) });" "...(fait ? { poste: fait.poste } : {}) });" \
  "$CMW"
prouver "le plafond de la caisse absent des Paramètres" web/public/v10/app.js \
  "            \${bridge.encaisser ? field(lbl('Remise permise sans code à la caisse (%)'" "            \${false ? field(lbl('Remise permise sans code à la caisse (%)'" \
  "$CMW"

# Vu à l'écran le 01/10/2026 (passage à la main) : le ticket imprimé sans sa remise, la fenêtre du responsable qui
# parlait d'un retour, le choix d'un responsable seul, la ligne de remise qui poussait « Encaisser ».
prouver "le ticket imprimé qui ne dit pas sa remise" web/public/v10/core.js \
  "        \${t.discount ? \`<tr><td>Remise \${escapeHtml(String(t.discountRate).replace('.', ','))} %</td>" "        \${false ? \`<tr><td>Remise \${escapeHtml(String(t.discountRate).replace('.', ','))} %</td>" \
  "$CMW"
prouver "la ligne de remise qui pousse « Encaisser » en apparaissant" web/public/v10/app.js \
  "' style=\"visibility:hidden\" aria-hidden=\"true\"'" "' style=\"display:none\"'" \
  "$CMW"
prouver "« Approuver » qu'on clique sans aucun responsable" web/public/v10/app.js \
  "\$('#rs-ok', root).disabled = !n;" "\$('#rs-ok', root).disabled = false;" \
  "$CMW"
prouver "la fenêtre d'une remise qui parle d'un retour" web/public/v10/app.js \
  ", 'Une remise au-delà de celle permise sans code').then(" ").then(" \
  "$CMW"
prouver "un responsable seul qu'il faut encore choisir" web/public/v10/app.js \
  "\${liste.length > 1 ? '<option value=\"\">Choisis…</option>' : ''}" "<option value=\"\">Choisis…</option>" \
  "$CTW"

prouver "la remise du panier en HT à côté de lignes en TTC" web/public/v10/app.js \
  "<span>− \${C.money(t.remiseTtc, cur)}</span>" "<span>− \${C.money(t.discount, cur)}</span>" \
  "$CMW"
prouver "le code du responsable qu'il faut d'abord cliquer" web/public/v10/app.js \
  "          if (n) \$('#rd-code', root).focus();" "          if (false) \$('#rd-code', root).focus();" \
  "$CMW"

# Vu à l'écran le 01/10/2026 (le retour d'un ticket remisé) : 1,284 DT rendus pour 1,156 payés.
prouver "le retour d'un ticket remisé qui rend le prix plein (serveur)" serveur/caisse/retour.ts \
  "      if (!meme(av.discountRate ?? 0, tk.contenu.discountRate ?? 0) || av.applyStamp) {" "      if (av.applyStamp) {" \
  "$CM"
prouver "le retour qui rend aussi le timbre (serveur)" serveur/caisse/retour.ts \
  "      if (!meme(av.discountRate ?? 0, tk.contenu.discountRate ?? 0) || av.applyStamp) {" "      if (!meme(av.discountRate ?? 0, tk.contenu.discountRate ?? 0)) {" \
  "$CM"
prouver "l'avoir d'un retour qui oublie la remise du ticket (écran)" web/public/v10/core.js \
  "lines: lignes, discountRate: Number(ticket.discountRate) || 0, applyStamp: false" "lines: lignes, discountRate: 0, applyStamp: false" \
  "$CMW"
prouver "l'annonce du retour qui oublie la remise du ticket" web/public/v10/app.js \
  "lines: lignes, discountRate: Number(doc.discountRate) || 0, applyStamp: false, currency: doc.currency" "lines: lignes, applyStamp: false, currency: doc.currency" \
  "$CMW"

# Vu à la main le 01/10/2026 : « Prendre la caisse » renvoyait la caisse à la connexion (l'ancien jeton relu).
prouver "le jeton du caissier suivant gardé dans la mémoire seulement, pas dans la session" web/public/plateforme/pont.js \
  "        sessionStorage.setItem('skanfact.jeton', r.jeton);
        if (localStorage.getItem('skanfact.jeton'))" "        if (localStorage.getItem('skanfact.jeton'))" \
  "$CRW"
prouver "le jeton du caissier suivant gardé dans la session seulement" web/public/plateforme/pont.js \
  "        if (localStorage.getItem('skanfact.jeton')) localStorage.setItem('skanfact.jeton', r.jeton);
" "" \
  "$CRW"

# ── Le Z imprimé et relu (brique 126, 01/10/2026 ; docs/caisse.md, Z1 à Z3) ──
CZ="le Z dit qui l'a fermé ; les Z se lisent par pages, tous pour la propriétaire, les siens pour un caissier"
CZW="Sami ferme la caisse : le Z dit qu'il l'a fermée, s'imprime, et se relit parmi les Z passés"
prouver "le Z qui ne dit pas qui l'a fermé" serveur/caisse/routes.ts \
  "ouverteLe: s.ouverte_le, ouvertePar: s.qui, appareil: s.appareil_nom, fermeeLe, fermePar };" "ouverteLe: s.ouverte_le, ouvertePar: s.qui, appareil: s.appareil_nom };" \
  "$CZ"
prouver "les Z de toute l'entreprise lus par un caissier" serveur/caisse/routes.ts \
  "and (\$3 or s.ouverte_par = socle.moi())" "and (true or s.ouverte_par = socle.moi())" \
  "$CZ"
prouver "les Z lus les plus anciens d'abord" serveur/caisse/routes.ts \
  "         order by s.fermee_le desc limit" "         order by s.fermee_le asc limit" \
  "$CZ"
prouver "la page suivante des Z qui relit la première" serveur/caisse/routes.ts \
  "(\$2::timestamptz is null or s.fermee_le < \$2)" "(true or s.fermee_le < \$2)" \
  "$CZ"
prouver "les Z sans page suivante" serveur/caisse/routes.ts \
  "        suite: lignes.length > PAGE_Z ?" "        suite: false ?" \
  "$CZ"
prouver "un curseur de Z illisible qui casse la lecture" serveur/caisse/routes.ts \
  "      const avant = /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z\$/.test(query.avant ?? '') ? query.avant : null;" "      const avant = query.avant ?? null;" \
  "$CZ"
prouver "le Z à l'écran qui ne dit pas qui l'a fermé" web/public/v10/app.js \
  "\${z.fermePar ? \`, fermée par \${h(z.fermePar)} le \${h(heureCaisse(z.fermeeLe))}\` : ''}" "" \
  "$CZW"
prouver "« Imprimer le Z » qui n'imprime rien" web/public/v10/app.js \
  "\$('#cs-z-imprimer', root).onclick = () => Promise.resolve(" "\$('#cs-z-imprimer', root).onclick = () => false && Promise.resolve(" \
  "$CZW"
prouver "le Z imprimé sans qui l'a fermé" web/public/v10/core.js \
  "      <div>Fermée le \${escapeHtml(quand(z.fermeeLe))} par \${escapeHtml(z.fermePar || '')}</div>
" "" \
  "$CZW"
prouver "le Z imprimé sans ce que le tiroir devait contenir" web/public/v10/core.js \
  "        \${ligne('Le tiroir devait contenir', m(z.attendu), 'tot')}
" "" \
  "$CZW"
prouver "les Z passés absents de « Tickets et bilan du jour »" web/public/v10/app.js \
  "      if (\$('#cs-les-z')) void dessinerLesZ(\$('#cs-les-z'));" "" \
  "$CZW"
prouver "« Plus de Z… » absent quand il en reste" web/public/v10/app.js \
  "\${r.suite ? '<button type=\"button\" class=\"btn btn-sm mt\" id=\"cs-z-plus\">Plus de Z…</button>' : ''}" "" \
  "$CZW"
prouver "« Plus de Z… » qui remplace la page lue au lieu de l'allonger" web/public/v10/app.js \
  "    const tous = (deja || []).concat(r.z);" "    const tous = r.z;" \
  "$CZW"
prouver "un Z passé qui ne se rouvre pas" web/public/v10/app.js \
  "    \$\$('[data-z]', el).forEach(tr => { tr.onclick = () => montrerZ(tous[Number(tr.dataset.z)]); });" "" \
  "$CZW"

prouver "le poste de la caisse rouvert par une caissière relais, sans son nom" serveur/caisse/routes.ts \
  "        (select appareil_nom from caisse.session where entreprise = \$2 and appareil = \$1 order by ouverte_le desc limit 1), '—') nom\`" "        null, '—') nom\`" \
  "$CR"

# Brique 127 : ce que la console d'un partenaire lit de la facturation (docs/api-situation.md, S1 à S5).
SIT="les factures à payer, la situation, le client retrouvé par son matricule, les liens des écrans"
prouver "un matricule cherché avec ses espaces" serveur/ventes/routes.ts \
  "query.identifiant.replace(/\\s+/g, '').toUpperCase()" "query.identifiant.toUpperCase()" \
  "$SIT"
prouver "un matricule cherché en minuscules" serveur/ventes/routes.ts \
  ".replace(/\\s+/g, '').toUpperCase() : null" ".replace(/\\s+/g, '') : null" \
  "$SIT"
prouver "un matricule rangé avec ses espaces" serveur/ventes/routes.ts \
  "upper(regexp_replace(identifiant, '[[:space:]]', '', 'g'))" "upper(identifiant)" \
  "$SIT"
prouver "un matricule rangé en minuscules" serveur/ventes/routes.ts \
  "upper(regexp_replace(identifiant, '[[:space:]]', '', 'g'))" "regexp_replace(identifiant, '[[:space:]]', '', 'g')" \
  "$SIT"
prouver "le matricule cherché ignoré" serveur/ventes/routes.ts \
  "        .\$if(identifiant !== null, (q) => q.where(sql<boolean>\`upper(regexp_replace(identifiant, '[[:space:]]', '', 'g')) = \${identifiant}\`))
" "" \
  "$SIT"
prouver "un client sans le lien de son écran" serveur/ventes/routes.ts \
  "ecran: lienEcran(params.entreprise ?? '', 'client', ref_v10)" "ecran: null" \
  "$SIT"
prouver "un client mal écrit qui fait tomber la liste des pièces" serveur/ventes/routes.ts \
  "      if (client !== null && !idValide(client)) return" "      if (client !== null && false) return" \
  "$SIT"
prouver "« à payer » accepté sur des devis" serveur/ventes/routes.ts \
  "      if (aPayer && type.data !== 'facture') return" "      if (false) return" \
  "$SIT"
prouver "« à payer » qui garde les factures réglées" serveur/ventes/routes.ts \
  "            if ((s.get(l.id)?.reste ?? 0n) <= 0n) continue;
" "" \
  "$SIT"
prouver "« à payer » qui déborde de la page" serveur/ventes/routes.ts \
  "            if (lignes.length === n) break;
" "" \
  "$SIT"
prouver "« à payer » qui relit le même lot" serveur/ventes/routes.ts \
  "          avant = [fin.date_piece, fin.id];" "" \
  "$SIT"
prouver "« à payer » sans page suivante" serveur/ventes/routes.ts \
  "          if (lignes.length === n) { plein = true; break; }" "          if (lignes.length === n) break;" \
  "$SIT"
prouver "un brouillon chiffré compté à payer" serveur/ventes/routes.ts \
  "ls.filter((l) => l.type === 'facture' && l.statut === 'emise' && l.net_a_payer !== null)" "ls.filter((l) => l.type === 'facture' && l.net_a_payer !== null)" \
  "$SIT"
prouver "un nombre annoncé pour « à payer » sans les avoir comptées" serveur/ventes/routes.ts \
  "const total = aPayer ? null : Number(" "const total = Number(" \
  "$SIT"
prouver "le nombre des pièces d'un client qui compte celles des autres" serveur/ventes/routes.ts \
  ".where('type', '=', type.data).\$if(client !== null, (q) => q.where('tiers', '=', client ?? '')).executeTakeFirstOrThrow()" ".where('type', '=', type.data).executeTakeFirstOrThrow()" \
  "$SIT"
prouver "les pièces d'un client mêlées à celles des autres" serveur/ventes/routes.ts \
  "        .\$if(client !== null, (q) => q.where('p.tiers', '=', client ?? ''))
" "" \
  "$SIT"
prouver "une facture listée sans son échéance" serveur/ventes/routes.ts \
  "echeance: l.echeance, " "" \
  "$SIT"
prouver "une facture listée sans son client" serveur/ventes/routes.ts \
  "clientId: l.tiers," "" \
  "$SIT"
prouver "une facture listée sans le lien de son écran" serveur/ventes/routes.ts \
  "              ecran: lienEcran(ent, 'doc', l.ref_v10),
" "" \
  "$SIT"
prouver "une situation demandée pour un identifiant mal écrit qui fait tomber le serveur" serveur/ventes/routes.ts \
  "      if (!idValide(params.client)) return { statut: 404" "      if (false) return { statut: 404" \
  "$SIT"
prouver "la situation d'un fournisseur" serveur/ventes/situation.ts \
  ".where('id', '=', client).where(sql<boolean>\`'client' = any(roles)\`).executeTakeFirst()" ".where('id', '=', client).executeTakeFirst()" \
  "$SIT"
prouver "la situation qui compte un brouillon" serveur/ventes/situation.ts \
  ".where('p.type', '=', 'facture').where('p.statut', '=', 'emise')" ".where('p.type', '=', 'facture')" \
  "$SIT"
prouver "la situation qui compte les factures d'un autre client" serveur/ventes/situation.ts \
  ".where('p.entreprise', '=', entreprise).where('p.tiers', '=', client).where('p.type', '=', 'facture')" ".where('p.entreprise', '=', entreprise).where('p.type', '=', 'facture')" \
  "$SIT"
prouver "la situation qui compte une facture réglée" serveur/ventes/situation.ts \
  "    if (reste <= 0n) continue;
" "" \
  "$SIT"
prouver "les euros additionnés aux dinars" serveur/ventes/situation.ts \
  "    parDevise.set(f.devise, d);" "    parDevise.set('TND', d);" \
  "$SIT"
prouver "une facture échue le jour même de son échéance" serveur/ventes/situation.ts \
  "f.echeance && f.echeance < aujourdhui" "f.echeance && f.echeance <= aujourdhui" \
  "$SIT"
prouver "le retard compté depuis la dernière échue" serveur/ventes/situation.ts \
  "      if (!retard) retard =" "      retard =" \
  "$SIT"
prouver "les échéances lues dans le désordre" serveur/ventes/situation.ts \
  "    .orderBy('p.echeance').execute();" "    .execute();" \
  "$SIT"
prouver "le retard compté à l'envers" serveur/ventes/situation.ts \
  "joursEntre(f.echeance, aujourdhui)" "joursEntre(aujourdhui, f.echeance)" \
  "$SIT"
prouver "le retard sans le lien de son écran" serveur/ventes/situation.ts \
  "ecran: lienEcran(entreprise, 'doc', f.ref_v10) };" "ecran: null };" \
  "$SIT"
prouver "le plus vieux règlement donné pour le dernier" serveur/ventes/situation.ts \
  ".orderBy('r.date_reglement', 'desc')" ".orderBy('r.date_reglement', 'asc')" \
  "$SIT"
prouver "deux règlements du même jour : le premier saisi donné pour le dernier" serveur/ventes/situation.ts \
  ".orderBy('r.id', 'desc')" ".orderBy('r.id', 'asc')" \
  "$SIT"
prouver "le dernier règlement d'un autre client" serveur/ventes/situation.ts \
  ".where('r.entreprise', '=', entreprise).where('p.tiers', '=', client)" ".where('r.entreprise', '=', entreprise)" \
  "$SIT"
prouver "un lien d'écran inventé pour ce qui n'est pas né des écrans" serveur/ventes/situation.ts \
  "(ref ? \`/v10/?e=\${entreprise}#/\${vue}/\${ref}\` : null)" "\`/v10/?e=\${entreprise}#/\${vue}/\${ref}\`" \
  "$SIT"
prouver "le lien de l'écran sans l'entreprise" serveur/ventes/situation.ts \
  "\`/v10/?e=\${entreprise}#/\${vue}/\${ref}\` : null" "\`/v10/#/\${vue}/\${ref}\` : null" \
  "$SIT"

LE="la connexion ramène à la facture du lien, dans son entreprise ; le lien d'une autre entreprise mène à l'accueil habituel"
prouver "le lien d'écran oublié avant la connexion" web/public/plateforme/pont.js \
  "    if (!jeton && ent) try { sessionStorage.setItem('skanfact.destination', location.pathname + location.search + location.hash); } catch { /* sans stockage : l'accueil */ }
" "" \
  "$LE"
prouver "le lien d'écran suivi vers l'entreprise d'un autre" web/src/App.tsx \
  "return d && e && siennes.some((x) => x.id === e) ? { adresse: d, entreprise: e } : null;" "return d && e ? { adresse: d, entreprise: e } : null;" \
  "$LE"
prouver "le lien d'écran suivi sans retenir son entreprise" web/src/App.tsx \
  "    if (demandee) { retenir(demandee.entreprise); location.assign(demandee.adresse); return; }" "    if (demandee) { location.assign(demandee.adresse); return; }" \
  "$LE"
prouver "le lien d'écran qui colle à toutes les visites suivantes" web/src/App.tsx \
  "d = sessionStorage.getItem(DESTINATION); sessionStorage.removeItem(DESTINATION);" "d = sessionStorage.getItem(DESTINATION);" \
  "$LE"

# Brique 128 : les avis des règlements (docs/api-situation.md, S6).
EV="chaque règlement nouveau, puis la facture réglée une seule fois ; par un avoir aussi ; jamais pour un ticket"
prouver "aucun avis pour un règlement nouveau" serveur/reglements.ts \
  "      nouveaux.push({ id, saisi: r });
" "" \
  "$EV"
prouver "un ticket de caisse annoncé comme un règlement" serveur/v10/dossier.ts \
  "  const ticket = apres.ticket === true;" "  const ticket = false;" \
  "$EV"
prouver "les règlements de l'écran jamais annoncés" serveur/v10/dossier.ts \
  "  if (!ticket) await annoncerReglements(tx, entreprise, piece.id, avant, nouveaux);
" "" \
  "$EV"
prouver "une facture déjà réglée annoncée réglée à chaque règlement de plus" serveur/ventes/annonces.ts \
  "  if (avant > 0n && f.reste <= 0n) {" "  if (f.reste <= 0n) {" \
  "$EV"
prouver "une facture soldée au millime jamais annoncée réglée" serveur/ventes/annonces.ts \
  "  if (avant > 0n && f.reste <= 0n) {" "  if (avant > 0n && f.reste < 0n) {" \
  "$EV"
prouver "la facture soldée par un avoir datée du dernier règlement" serveur/ventes/annonces.ts \
  "    const date = par?.date ?? (await" "    const date = (await" \
  "$EV"
prouver "la facture réglée datée du plus ancien règlement" serveur/ventes/annonces.ts \
  "eb.fn.max('date_reglement')" "eb.fn.min('date_reglement')" \
  "$EV"
prouver "un avoir qui solde annoncé comme un règlement" serveur/ventes/annonces.ts \
  "par: par?.par ?? 'reglement' });" "par: 'reglement' });" \
  "$EV"
prouver "un règlement annoncé avec le reste d'avant lui" serveur/ventes/annonces.ts \
  "reference: r.saisi.reference, devise: f.devise, facture, client, reste: m(f.reste)," "reference: r.saisi.reference, devise: f.devise, facture, client, reste: m(avant)," \
  "$EV"
prouver "un avoir qui solde sans avis" serveur/ventes/pieces.ts \
  "  if (avantAvoir !== null && p.corrige) await annoncerReglements(tx, entreprise, p.corrige, avantAvoir, [], { par: 'avoir', date: p.date_piece });
" "" \
  "$EV"
prouver "une facture annoncée sans le lien de son écran" serveur/ventes/annonces.ts \
  "  const facture = { id: f.id, numero: f.numero_texte, ecran: lienEcran(entreprise, 'doc', f.ref_v10) };" "  const facture = { id: f.id, numero: f.numero_texte, ecran: null };" \
  "$EV"
prouver "un abonnement à « facture réglée » refusé" serveur/avis.ts \
  "export const EVENEMENTS = ['facture.emise', 'reglement.enregistre', 'facture.reglee'] as const;" "export const EVENEMENTS = ['facture.emise', 'reglement.enregistre'] as const;" \
  "$EV"

# Brique 129 : les factures périodiques émises seules (docs/api-situation.md, S7).
CS="le serveur émet les factures dues des contrats émis seuls, rattrape les périodes, n'émet rien deux fois, note un refus"
CSW="la propriétaire coche « Émise seule » ; la fiche le dit, ne propose plus de brouillon, et dit un refus ; la case est grisée pour le commercial"
prouver "un contrat ordinaire lu par le tour des contrats émis seuls" base/migrations/0065_contrats_seuls.sql \
  "     and d.contenu ->> 'emettreSeul' = 'true'
" "" \
  "$CS"
prouver "un contrat suspendu lu par le tour des contrats émis seuls" base/migrations/0065_contrats_seuls.sql \
  "     and coalesce(d.contenu ->> 'active', 'true') <> 'false'
" "" \
  "$CS"
prouver "un contrat à la date mal écrite lu par le tour" base/migrations/0065_contrats_seuls.sql \
  "     and d.contenu ->> 'nextDate' ~ '^\\d{4}-\\d{2}-\\d{2}\$'
" "" \
  "$CS"
prouver "un contrat dû aujourd'hui attendu demain" base/migrations/0065_contrats_seuls.sql \
  "     and d.contenu ->> 'nextDate' <= p_jour::text" "     and d.contenu ->> 'nextDate' < p_jour::text" \
  "$CS"
prouver "un contrat refusé retenté à chaque tour du même jour" base/migrations/0065_contrats_seuls.sql \
  "     and coalesce(d.contenu -> 'refusServeur' ->> 'le', '') <> p_jour::text
" "" \
  "$CS"
prouver "un commercial qui fait d'un contrat un contrat émis seul" base/migrations/0065_contrats_seuls.sql \
  "     and not (socle.mes_roles(new.entreprise) && array['proprietaire', 'administrateur']) then
    raise exception 'Une facture émise seule" "     and false then
    raise exception 'Une facture émise seule" \
  "$CS"
prouver "un commercial empêché de modifier un contrat déjà émis seul" base/migrations/0065_contrats_seuls.sql \
  "  if apres is distinct from avant and socle.moi() is not null" "  if apres and socle.moi() is not null" \
  "$CS"
prouver "un contrat ordinaire émis s'il est appelé" serveur/v10/contrats.ts \
  "  if (!ligne || ligne.contenu.emettreSeul !== true || ligne.contenu.active === false) return 0;" "  if (!ligne || ligne.contenu.active === false) return 0;" \
  "$CS"
prouver "un contrat suspendu émis s'il est appelé" serveur/v10/contrats.ts \
  "  if (!ligne || ligne.contenu.emettreSeul !== true || ligne.contenu.active === false) return 0;" "  if (!ligne || ligne.contenu.emettreSeul !== true) return 0;" \
  "$CS"
prouver "plus de douze périodes rattrapées d'un coup" serveur/v10/contrats.ts \
  "periodes < 12)" "periodes < 13)" \
  "$CS"
prouver "une facture déjà émise refaite quand la date du contrat recule" serveur/v10/contrats.ts \
  "    if (!(await lire(tx, entreprise, 'documents', id))) {" "    if (true) {" \
  "$CS"
prouver "un contrat réparé qui garde son refus" serveur/v10/contrats.ts \
  "  delete rec.refusServeur;
" "" \
  "$CS"
prouver "un contrat trimestriel avancé d'un mois" serveur/v10/contrats.ts \
  "every === 'quarter' ? 3 : 1" "every === 'quarter' ? 1 : 1" \
  "$CS"
prouver "un contrat annuel avancé d'un mois" serveur/v10/contrats.ts \
  "every === 'year' ? 12 :" "every === 'year' ? 1 :" \
  "$CS"
prouver "le 31 d'un mois de trente jours" serveur/v10/contrats.ts \
  "const j = Math.min(Math.max(1, Number(jour) || Number(iso.slice(8, 10))), dernier);" "const j = Math.max(1, Number(jour) || Number(iso.slice(8, 10)));" \
  "$CS"
prouver "le délai de paiement de l'entreprise ignoré" serveur/v10/contrats.ts \
  "? Math.round(Number(societe.paymentTermsDays)) : 30;" "? 30 : 30;" \
  "$CS"
prouver "le timbre posé pour un client exonéré" serveur/v10/contrats.ts \
  "applyStamp: !(client && client.stampExempt)" "applyStamp: true" \
  "$CS"
prouver "l'objet d'une facture périodique sans son mois" serveur/v10/contrats.ts \
  "subject: remplir(rec.subject, v)" "subject: rec.subject" \
  "$CS"
prouver "la description d'une ligne sans son mois" serveur/v10/contrats.ts \
  "description: remplir(l.description ?? '', v)" "description: l.description ?? ''" \
  "$CS"
prouver "les notes d'une facture périodique sans leur année" serveur/v10/contrats.ts \
  "notes: remplir(rec.notes ?? '', v)" "notes: rec.notes ?? ''" \
  "$CS"
prouver "un refus noté sans sa raison" serveur/v10/contrats.ts \
  "const motif = e instanceof Refus ? e.message :" "const motif = false ? e.message :" \
  "$CS"
prouver "un refus noté sans son jour" serveur/v10/contrats.ts \
  "refusServeur: { le: jour," "refusServeur: { le: ''," \
  "$CS"
prouver "une facture du serveur comparée à un écran qui n'existe pas" serveur/v10/dossier.ts \
  "  if (demande.netAPayer !== null && serveur !== demande.netAPayer) throw" "  if (serveur !== demande.netAPayer) throw" \
  "$CS"
prouver "un contrat émis seul compté à générer dans le menu" web/public/v10/core.js \
  "r.active !== false && !r.emettreSeul && r.nextDate && r.nextDate <= t);" "r.active !== false && r.nextDate && r.nextDate <= t);" \
  "$CSW"
prouver "un contrat émis seul qui propose son brouillon" web/public/v10/app.js \
  "    const isDue = active && !r.emettreSeul && r.nextDate <= C.today();" "    const isDue = active && r.nextDate <= C.today();" \
  "$CSW"
prouver "la fiche d'un contrat émis seul qui ne le dit pas" web/public/v10/app.js \
  "      \${r.emettreSeul && active ? \`<div class=\"banner info\" id=\"c-seul\">" "      \${false ? \`<div class=\"banner info\" id=\"c-seul\">" \
  "$CSW"
prouver "la fiche d'un contrat refusé qui ne dit pas pourquoi" web/public/v10/app.js \
  "      \${r.refusServeur ? \`<div class=\"banner warn\" id=\"c-refus\">" "      \${false ? \`<div class=\"banner warn\" id=\"c-refus\">" \
  "$CSW"
prouver "un contrat corrigé qui attend demain" web/public/v10/app.js \
  "          delete r.refusServeur;
" "" \
  "$CSW"
prouver "la case « émise seule » ouverte au commercial" web/public/v10/app.js \
  "\${bridge.droitsDossier().responsable ? '' : 'disabled'}>" "\${''}>" \
  "$CSW"
prouver "le serveur qui ne fait jamais son tour des contrats" serveur/principal.ts \
  "  const contrats = setInterval(tourDesContrats, c.contratsMs);" "  const contrats = setInterval(() => undefined, c.contratsMs);" \
  "$CSW"
prouver "un serveur redémarré qui attend une heure son premier tour" serveur/principal.ts \
  "  tourDesContrats();
" "" \
  "$CSW"
prouver "la liste qui dit « à générer » d'un contrat émis seul" web/public/v10/app.js \
  "\${r.emettreSeul && r.active !== false ? ' <span class=\"level\" data-seul>émise seule</span>' : isDue ?" "\${isDue ?" \
  "$CSW"
prouver "le filtre « À générer » qui montre les contrats émis seuls" web/public/v10/app.js \
  "(r.active !== false && !r.emettreSeul && r.nextDate <= C.today()) : (s.st === 'actif')" "(r.active !== false && r.nextDate <= C.today()) : (s.st === 'actif')" \
  "$CSW"
prouver "la page vide qui promet que rien n'est jamais émis à ta place" web/public/v10/app.js \
  "               'Rien n\\'est émis à ta place : un brouillon t\\'attend. Sauf si tu le demandes : un contrat « Émise seule » voit SkanFact émettre ses factures à leur date.'," "               'Rien n\\'est envoyé à ta place : un brouillon t\\'attend, c\\'est tout.'," \
  "$CSW"

# Brique 130 : les contrats d'abonnement par l'API (docs/api-situation.md, S8).
AC="une clé crée, lit, modifie, suspend et reprend un contrat ; émis seul, ses factures partent par le serveur"
prouver "le dossier rempli par l'API sans la fiche de l'entreprise" serveur/v10/dossier.ts \
  "  if (!un) await amorcer(tx, entreprise, utilisateur);" "  if (!un && false) await amorcer(tx, entreprise, utilisateur);" \
  "$AC"
prouver "un client de l'API qui entre deux fois dans le dossier" serveur/v10/dossier.ts \
  "  if (t.ref_v10) return t.ref_v10;
" "" \
  "$AC"
prouver "un fournisseur pris pour un client par l'API" serveur/v10/dossier.ts \
  "    .where('entreprise', '=', entreprise).where('id', '=', tiers).where(sql<boolean>\`'client' = any(roles)\`).executeTakeFirst();
  if (!t) return null;" "    .where('entreprise', '=', entreprise).where('id', '=', tiers).executeTakeFirst();
  if (!t) return null;" \
  "$AC"
prouver "un client entré dans le dossier sans que sa fiche le sache" serveur/v10/dossier.ts \
  "  await db.updateTable('socle.tiers').set({ ref_v10: t.id }).where('id', '=', t.id).execute();
  return t.id;" "  return t.id;" \
  "$AC"
prouver "un contrat de l'API jamais émis seul" serveur/v10/api-contrats.ts \
  "notes: c.notes ?? '', emettreSeul: c.emettreSeul === true," "notes: c.notes ?? '', emettreSeul: false," \
  "$AC"
prouver "le jour d'un contrat de l'API oublié" serveur/v10/api-contrats.ts \
  "day: c.jour ?? Number(c.prochaine.slice(8, 10))," "day: c.jour ?? 1," \
  "$AC"
prouver "un contrat annuel de l'API facturé chaque mois" serveur/v10/api-contrats.ts \
  "const PERIODES = { mois: 'month', trimestre: 'quarter', annee: 'year' } as const;" "const PERIODES = { mois: 'month', trimestre: 'quarter', annee: 'month' } as const;" \
  "$AC"
prouver "un contrat lu sans son client" serveur/v10/api-contrats.ts \
  "id: cle, client: tiers?.id ?? null," "id: cle, client: null," \
  "$AC"
prouver "un contrat modifié par l'API qui garde son refus" serveur/v10/api-contrats.ts \
  "      delete contenu.refusServeur;
" "" \
  "$AC"
prouver "un contrat modifié par l'API qui oublie ce qui a été facturé" serveur/v10/api-contrats.ts \
  "      const contenu: Json = { ...l.contenu, ...enV10(corps, clientId) };" "      const contenu: Json = { id: params.contrat, active: true, ...enV10(corps, clientId) };" \
  "$AC"
prouver "un contrat repris qui rattrape les échéances de sa suspension" serveur/v10/api-contrats.ts \
  "          for (let i = 0; d < auj && i < 240; i++) d = echeanceSuivante(d, contenu.every, contenu.day);
" "" \
  "$AC"
prouver "les contrats d'un client mêlés à ceux des autres" serveur/v10/api-contrats.ts \
  "if (client === null || l.contenu.clientId === client)" "if (true)" \
  "$AC"
prouver "un contrat suspendu qui reste actif" serveur/v10/api-contrats.ts \
  "const contenu: Json = { ...l.contenu, active: geste === 'reprendre' };" "const contenu: Json = { ...l.contenu, active: true };" \
  "$AC"

# Brique 131 : les commandes d'une boutique en ligne, facturées dans SkanFact (docs/boutique.md).
BQ="une commande devient une facture payée, au millime, une seule fois ; ses écritures suivent"
prouver "une commande renvoyée qui fait une seconde facture" serveur/v10/boutique.ts \
  "      if (deja) return { corps: deja };
" "" \
  "$BQ"
prouver "le dossier d'une boutique sans la fiche de l'entreprise" serveur/v10/boutique.ts \
  "      await dossierPret(tx, ent, qui.utilisateur);
" "" \
  "$BQ"
prouver "un client de boutique créé à chaque commande" serveur/v10/boutique.ts \
  "      if (!client) {" "      if (true) {" \
  "$BQ"
prouver "un client de boutique reconnu sans sa référence" serveur/v10/boutique.ts \
  "empreinte(c.ref ? \`ref:\${c.ref}\` : c.email ?" "empreinte(c.email ?" \
  "$BQ"
prouver "un client de boutique dont la casse de l'e-mail change tout" serveur/v10/boutique.ts \
  "\`email:\${c.email.toLowerCase()}\`" "\`email:\${c.email}\`" \
  "$BQ"
prouver "un client de boutique sans son téléphone" serveur/v10/boutique.ts \
  "          phone: corps.client.telephone ?? '', currency: '' };" "          phone: '', currency: '' };" \
  "$BQ"
prouver "un prix TTC qui ne redonne jamais son TTC" serveur/v10/boutique.ts \
  "    if (avecTva(h) === ttc) return { ht: h, manque: 0n };
" "" \
  "$BQ"
prouver "le millime qui manque perdu" serveur/v10/boutique.ts \
  "  if (arrondi > 0n) v10.push(" "  if (false) v10.push(" \
  "$BQ"
prouver "une quantité que le prix HT ne redonne pas, facturée quand même" serveur/v10/boutique.ts \
  "    if (diviserArrondi(q3 * p6, MILLION) !== ht) throw new Refus(" "    if (false) throw new Refus(" \
  "$BQ"
prouver "un article de la boutique jamais relié au catalogue" serveur/v10/boutique.ts \
  ", ...(article ? { itemId: article } : {}) };" " };" \
  "$BQ"
prouver "un code d'article de la boutique lu avec sa casse" serveur/v10/boutique.ts \
  "    const code = (l.code ?? '').replace(/\\s+/g, '').toUpperCase();" "    const code = (l.code ?? '').replace(/\\s+/g, '');" \
  "$BQ"
prouver "un code d'article du catalogue lu avec ses espaces" serveur/v10/boutique.ts \
  "upper(regexp_replace(contenu->>'code', '[[:space:]]', '', 'g')) code" "upper(contenu->>'code') code" \
  "$BQ"
prouver "une ligne au prix HT comptée comme un TTC" serveur/v10/boutique.ts \
  "{ ttcTotal = null; return" "{ return" \
  "$BQ"
prouver "un total de commande qui ne tombe pas juste, facturé quand même" serveur/v10/boutique.ts \
  "      if (attendu !== null && attendu !== net) throw" "      if (false) throw" \
  "$BQ"
prouver "le timbre oublié dans le total attendu" serveur/v10/boutique.ts \
  "      const timbre = corps.timbre ? 1000n : 0n;" "      const timbre = 0n;" \
  "$BQ"
prouver "le timbre posé sur une commande qui n'en veut pas" serveur/v10/boutique.ts \
  "discountRate: 0, applyStamp: corps.timbre, withholdingRate: 0," "discountRate: 0, applyStamp: true, withholdingRate: 0," \
  "$BQ"
prouver "le paiement d'une commande enregistré deux fois" serveur/v10/boutique.ts \
  "  if (paiements.some((x) => x.id === id)) return;
" "" \
  "$BQ"
prouver "une commande payée facturée sans son paiement" serveur/v10/boutique.ts \
  "      if (corps.paiement) await ajouterPaiement(" "      if (false) await ajouterPaiement(" \
  "$BQ"
prouver "un paiement pour une commande inconnue accepté" serveur/v10/boutique.ts \
  "      if (!(await resultat(tx, ent, params.reference ?? '', true))) return { statut: 404," "      if (false) return { statut: 404," \
  "$BQ"
prouver "une clé qui ne prend jamais la série des factures" base/migrations/0066_serie_par_cle.sql \
  "             or (p_prefixe <> 'TIC' and exists (" "             or (false and exists (" \
  "$BQ"
prouver "une clé qui prend la série des tickets" base/migrations/0066_serie_par_cle.sql \
  "             or (p_prefixe <> 'TIC' and exists (" "             or (true and exists (" \
  "$BQ"
prouver "une clé sans geste d'émission qui prend la série" base/migrations/0066_serie_par_cle.sql \
  " and k.gestes && array['ventes.facture.emettre', 'ventes.boutique.facturer']))) then" "))) then" \
  "$BQ"

# Brique 132 : le retour d'une commande en ligne (un avoir, et l'argent rendu).
BR="un retour est un avoir de la facture, l'argent rendu un règlement négatif, une seule fois, jamais plus que la commande"
prouver "l'objet d'un avoir de retour montre l'identifiant brut du partenaire" serveur/v10/textes.ts \
  "'boutique.objet_retour': 'Retour de la commande {reference}'," "'boutique.objet_retour': 'Retour de la commande {reference} ({retour})'," \
  "$BR"
prouver "un retour renvoyé qui fait un second avoir" serveur/v10/boutique.ts \
  "      if (await resultatDuRetour(tx, ent, reference, corps.id, true)) {" "      if (false) {" \
  "$BR"
prouver "un retour renvoyé qui n'ajoute jamais l'argent rendu" serveur/v10/boutique.ts \
  "        await rembourser(tx, ent, qui.utilisateur, reference, corps.id, corps.date, corps.remboursement);" "        void 0;" \
  "$BR"
prouver "l'argent d'un retour rendu deux fois" serveur/v10/boutique.ts \
  "  if (await requetes(tx).selectFrom('ventes.reglement').select('id').where('entreprise', '=', entreprise).where('ref_v10', '=', pid).executeTakeFirst()) return;" "  if (false) return;" \
  "$BR"
prouver "rendre plus que ce que le client a payé en trop" serveur/v10/boutique.ts \
  "  if (voulu > -reste) throw" "  if (false) throw" \
  "$BR"
prouver "l'argent rendu compté comme un paiement" serveur/v10/boutique.ts \
  "montant: \`-\${r.montant}\`" "montant: r.montant" \
  "$BR"
prouver "un retour plus grand que ce qui reste de la commande" serveur/v10/boutique.ts \
  "      if (net > possible) throw" "      if (false) throw" \
  "$BR"
prouver "un retour qui oublie les avoirs déjà émis" serveur/v10/boutique.ts \
  "const possible = (facture.net_a_payer ?? 0n) - credite;" "const possible = (facture.net_a_payer ?? 0n);" \
  "$BR"
prouver "toute la commande rendue après une partie" serveur/v10/boutique.ts \
  "        if (avoirs.length) return { statut: 409," "        if (false) return { statut: 409," \
  "$BR"
prouver "le timbre rendu sans avoir été payé" serveur/v10/boutique.ts \
  "      if (corps.timbre && (!(facture.timbre ?? 0n) ||" "      if (corps.timbre && (false ||" \
  "$BR"
prouver "le timbre rendu deux fois" serveur/v10/boutique.ts \
  "|| avoirs.some((a) => (a.timbre ?? 0n) > 0n))) throw" "|| false)) throw" \
  "$BR"
prouver "toute la commande comparée sans son timbre" serveur/v10/boutique.ts \
  "(corps.timbre ? 0n : facture.timbre ?? 0n), 3);" "(corps.timbre ? facture.timbre ?? 0n : 0n), 3);" \
  "$BR"
prouver "le timbre oublié dans le total attendu d'un retour" serveur/v10/boutique.ts \
  "attendu = versTexte(l.ttcTotal + (corps.timbre ? facture.timbre ?? 0n : 0n), 3);" "attendu = versTexte(l.ttcTotal, 3);" \
  "$BR"
prouver "un retour au total faux émis quand même" serveur/v10/boutique.ts \
  "      if (attendu !== null && attendu !== versTexte(net, 3)) throw" "      if (false) throw" \
  "$BR"
prouver "le timbre d'un retour jamais porté sur l'avoir" serveur/v10/boutique.ts \
  "}), 'fr'), reference, lines: lignes, discountRate: 0, applyStamp: corps.timbre," "}), 'fr'), reference, lines: lignes, discountRate: 0, applyStamp: false," \
  "$BR"
prouver "un article rendu jamais relié au catalogue" serveur/v10/boutique.ts \
  "const l = lignesDeFacture(corps.lignes, await catalogueParCode(tx, ent));" "const l = lignesDeFacture(corps.lignes, new Map());" \
  "$BR"
prouver "un retour d'une commande inconnue accepté" serveur/v10/boutique.ts \
  "      if (!facture) return { statut: 404," "      if (false) return { statut: 404," \
  "$BR"
prouver "un montant de zéro accepté" serveur/v10/boutique.ts \
  "const montant = decimal(3).refine((x) => depuisTexte(x, 3) > 0n," "const montant = decimal(3).refine(() => true," \
  "$BR"
prouver "l'argent rendu jamais dit dans la réponse" serveur/v10/boutique.ts \
  "rembourse: versTexte(-rendu, 3)" "rembourse: versTexte(0n, 3)" \
  "$BR"
prouver "l'argent rendu d'un retour pris pour celui d'un autre" serveur/v10/boutique.ts \
  "/retour:\${id}\`).slice(0, 24)}\`;" "/retour:\`).slice(0, 24)}\`;" \
  "$BR"
prouver "l'avoir d'un retour pris pour celui d'un autre" serveur/v10/boutique.ts \
  "\`ret-\${empreinte(\`\${reference}/\${id}\`).slice(0, 24)}\`;" "\`ret-\${empreinte(\`\${reference}\`).slice(0, 24)}\`;" \
  "$BR"

prouver "un avoir de retour sans le numéro de sa facture" serveur/v10/boutique.ts \
  "creditOfNumber: facture.numero_texte," "creditOfNumber: ''," \
  "$BR"
prouver "le motif d'un retour perdu" serveur/v10/boutique.ts \
  "creditReason: corps.motif ?? ''," "creditReason: ''," \
  "$BR"
prouver "un retour neuf qui se dit « déjà fait »" serveur/v10/boutique.ts \
  "return { reference: ref, client, facture, retour: { id, deja," "return { reference: ref, client, facture, deja: true, retour: { id, deja," \
  "$BR"

# Brique 133 : « Connecter ma boutique » (un partenaire déclaré, un code échangé contre la clé).
BP="autoriser, échanger le code une fois contre la clé ; rien pour un inconnu, un faux secret, un code usé, expiré ou révoqué"
BW="se connecter, choisir son entreprise, autoriser : SkanEcom reçoit le code et l'échange ; refuser ne donne rien"
BS="sans entreprise : la page la fait créer, puis autoriser"
prouver "une adresse de retour non déclarée suivie" serveur/partenaires.ts \
  "&& p.retours.includes(retour.split('?')[0] ?? '');" "&& true;" \
  "$BP"
prouver "une ancre acceptée dans l'adresse de retour" serveur/partenaires.ts \
  "=> !retour.includes('#') && p.retours" "=> p.retours" \
  "$BP"
prouver "la page qui montre une demande vers une adresse non déclarée" serveur/partenaires.ts \
  "      if (!retourPermis(p, String(query.retour ?? ''))) return" "      if (false) return" \
  "$BP"
prouver "une autorisation vers une adresse non déclarée" serveur/partenaires.ts \
  "      if (!retourPermis(p, corps.retour)) return" "      if (false) return" \
  "$BP"
prouver "un faux secret de partenaire accepté" serveur/partenaires.ts \
  "const secretJuste = (p: Partenaire, entete: string | undefined) => memeEmpreinte(" "const secretJuste = (p: Partenaire, entete: string | undefined) => true || memeEmpreinte(" \
  "$BP"
prouver "la clé qui se lit dans le code" serveur/partenaires.ts \
  "const cleDuCode = (cle: Buffer, code: string) => PREFIXE_CLE + createHmac('sha256', cle).update(\`skanfact.partenaire:\${code}\`, 'utf8').digest('base64url');" "const cleDuCode = (cle: Buffer, code: string) => PREFIXE_CLE + code;" \
  "$BP"
prouver "une clé d'autorisation qui vaut une heure" serveur/partenaires.ts \
  "const CODE_MS = 10 * 60_000;" "const CODE_MS = 60 * 60_000;" \
  "$BP"
prouver "une clé échangée qui vaut deux ans" serveur/partenaires.ts \
  "const CLE_JOURS = 365;" "const CLE_JOURS = 730;" \
  "$BP"
prouver "un code échangé pour un autre partenaire" base/migrations/0067_autorisation_partenaire.sql \
  "where a.partenaire = p_partenaire and a.code_empreinte = p_empreinte" "where a.code_empreinte = p_empreinte" \
  "$BP"
prouver "un code échangé deux fois" base/migrations/0067_autorisation_partenaire.sql \
  "or v.echangee_le is not null or" "or" \
  "$BP"
prouver "un code expiré échangé" base/migrations/0067_autorisation_partenaire.sql \
  "or v.expire_le <= now() then return;" "then return;" \
  "$BP"
prouver "une clé révoquée qui revit à l'échange" base/migrations/0067_autorisation_partenaire.sql \
  "where k.id = v.cle_api and k.revoquee_le is null;" "where k.id = v.cle_api;" \
  "$BP"
prouver "l'échange qui laisse la clé à dix minutes" base/migrations/0067_autorisation_partenaire.sql \
  "update socle.cle_api k set expire_le = p_expire_le" "update socle.cle_api k set expire_le = k.expire_le" \
  "$BP"
prouver "un commercial qui autorise un partenaire en base" base/migrations/0067_autorisation_partenaire.sql \
  "  if not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']) then
    perform socle.refus('ton rôle ne permet pas de gérer les clés de l''API');
  end if;
  if not exists" "  if not exists" \
  "$BP"
prouver "une autorisation pour la clé d'une autre entreprise" base/migrations/0067_autorisation_partenaire.sql \
  "k.id = p_cle and k.entreprise = p_entreprise and" "k.id = p_cle and" \
  "$BP"
prouver "l'autorisation sans trace" base/migrations/0067_autorisation_partenaire.sql \
  "  perform socle.tracer(p_entreprise, 'socle.partenaire.autoriser', 'cle_api', p_cle, null, jsonb_build_object('partenaire', p_partenaire));" "  null;" \
  "$BP"
prouver "l'échange sans trace" base/migrations/0067_autorisation_partenaire.sql \
  "  perform socle.tracer(v.entreprise, 'socle.partenaire.echanger', 'cle_api', v.cle_api, null, jsonb_build_object('partenaire', p_partenaire, 'expire_le', p_expire_le));" "  null;" \
  "$BP"
prouver "la page qui propose l'entreprise d'essai" web/src/ecrans/Connecter.tsx \
  "liste.filter((e) => !e.essai && e.roles.some" "liste.filter((e) => e.roles.some" \
  "$BW"
prouver "la page qui propose une entreprise où l'on n'est que commercial" web/src/ecrans/Connecter.tsx \
  "e.roles.some((r) => r === 'proprietaire' || r === 'administrateur'));" "true);" \
  "$BW"
prouver "la demande de connexion jamais oubliée en partant" web/src/App.tsx \
  "partir={(adresse) => { connexionDemandee.oublier(); location.assign(adresse); }}" "partir={(adresse) => { location.assign(adresse); }}" \
  "$BW"
prouver "l'entreprise ouverte par-dessus la page Connecter" web/src/App.tsx \
  "|| invitation.lire() || demandeConnexion) return;" "|| invitation.lire()) return;" \
  "$BW"
prouver "la demande de connexion perdue à la connexion" web/src/App.tsx \
  "if (location.pathname === '/connecter') {" "if (location.pathname === '/jamais') {" \
  "$BW"
prouver "la connexion qui ne dit pas qui attend" web/src/App.tsx \
  "inscription={vers({ ecran: 'inscription' })} sous={attend}" "inscription={vers({ ecran: 'inscription' })}" \
  "$BW"
prouver "refuser qui ne dit pas le refus" web/src/ecrans/Connecter.tsx \
  "const suite = new URLSearchParams({ erreur: 'refusee', etat: demande.etat });" "const suite = new URLSearchParams({ etat: demande.etat });" \
  "$BW"
prouver "la page qui ne fait pas créer l'entreprise" web/src/ecrans/Connecter.tsx \
  "    if (r.statut === 201) { setChoisie(r.corps.id); creee(); } else" "    if (r.statut === 201) { setChoisie(r.corps.id); } else" \
  "$BS"

# Brique 134 : « Services connectés » (voir et couper l'accès d'un partenaire).
BSC="la boutique reliée se voit avec ce qu'elle peut faire ; « Couper l'accès » demande, puis coupe, et la clé ne vaut plus rien"
prouver "le panneau Services connectés jamais posé" web/public/v10/app.js \
  "\${bridge.dessinerServices ? \`\${panneau('p-services')}<div id=\"services-panel\"></div></div>\` : ''}" "" \
  "$BSC"
prouver "le panneau Services connectés jamais dessiné" web/public/v10/app.js \
  "    if (bridge.dessinerServices && \$('#services-panel')) void bridge.dessinerServices(\$('#services-panel'));
" "" \
  "$BSC"
prouver "une clé coupée montrée dans Services connectés" web/public/plateforme/pont.js \
  "cles.filter((k) => !k.revoquee_le && Date.parse(k.expire_le) > Date.now())" "cles.filter((k) => Date.parse(k.expire_le) > Date.now())" \
  "$BSC"
prouver "une clé expirée montrée dans Services connectés" web/public/plateforme/pont.js \
  "cles.filter((k) => !k.revoquee_le && Date.parse(k.expire_le) > Date.now())" "cles.filter((k) => !k.revoquee_le)" \
  "$BSC"
prouver "couper l'accès sans le demander" web/public/plateforme/pont.js \
  "il faudra le reconnecter depuis le service.\`);
          return;" "il faudra le reconnecter depuis le service.\`);" \
  "$BSC"
prouver "l'accès jamais coupé" web/public/plateforme/pont.js \
  "          await appel('DELETE', \`/cles-api/\${encodeURIComponent(String(bouton.dataset.couper))}\`);
" "" \
  "$BSC"
prouver "ce qu'une clé peut faire jamais dit en mots" serveur/routes/socle.ts \
  "peut: k.gestes.map((g) => t(\`geste.\${g}\`))" "peut: k.gestes" \
  "$BSC"
prouver "les jours dits à l'heure du navigateur, pas de Tunis" web/public/plateforme/pont.js \
  "toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis', day:" "toLocaleDateString('fr-FR', { day:" \
  "$BSC"
prouver "SkanEcom jamais déclaré par défaut" serveur/principal.ts \
  "lirePartenaires(env.SKANFACT_PARTENAIRES ?? fs.readFileSync(path.join(ici, 'partenaires.json'), 'utf8'), { essai" "lirePartenaires(env.SKANFACT_PARTENAIRES, { essai" \
  "SkanEcom est déclaré dans le dépôt : son adresse de retour, l'empreinte de son secret, ses gestes"
# Brique 141 : la facture validée par la TTN dans l'espace client (docs/espace-client.md, E8).
EE="le client télécharge par son lien la facture que la TTN a validée, et seulement elle (brique 141)"
EP="la pièce signée attend le compte El Fatoora ; Nadia le pose depuis la fenêtre ; acceptée, la facture validée se télécharge, et la pièce imprimée porte sa référence et son code QR, jusque dans l'espace client"
EV="le lien d'une facture, puis celui du compte : la pièce comme imprimée, ce qu'il doit, vu, puis retiré"
prouver "une pièce signée mais pas acceptée se télécharge" base/migrations/0069_espace_efacture.sql \
  "           where x.piece = v_piece and x.statut = 'acceptee');" "           where x.piece = v_piece);" \
  "$EE"
prouver "un avoir et une facture de même numéro confondus" base/migrations/0069_espace_efacture.sql \
  "   where x ->> 'type' = p_type and x ->> 'numero' = p_numero;" "   where x ->> 'numero' = p_numero;" \
  "$EE"
prouver "une pièce hors du lien se télécharge" base/migrations/0069_espace_efacture.sql \
  "  select (x ->> 'id')::uuid into v_piece from jsonb_array_elements(ventes.pieces_du_lien(l.id)) x
   where x ->> 'type' = p_type and x ->> 'numero' = p_numero;" "  select p.id into v_piece from ventes.piece p where p.entreprise = l.entreprise and p.type = p_type and p.numero_texte = p_numero;" \
  "$EE"
prouver "un lien retiré télécharge encore" base/migrations/0069_espace_efacture.sql \
  "  l := ventes.lien_valable(p_jeton_empreinte);" "  select * into l from ventes.lien where jeton_empreinte = p_jeton_empreinte;" \
  "$EE"
prouver "le fichier signé au lieu de la facture validée" base/migrations/0069_espace_efacture.sql \
  "'_ttn.xml'), 'xml', x.xml_valide)" "'_ttn.xml'), 'xml', (select g.xml from ventes.efacture_signee g where g.piece = x.piece))" \
  "$EE"
prouver "la facture validée sous le nom du fichier écrit" base/migrations/0069_espace_efacture.sql \
  "jsonb_build_object('nom', regexp_replace(e.nom, '\.xml\$', '_ttn.xml'), 'xml'" "jsonb_build_object('nom', e.nom, 'xml'" \
  "$EE"
prouver "rien à télécharger répond comme un fichier" serveur/ventes/routes.ts \
  "      if (!f) return { statut: 404, corps: { motif: motif('espace.efacture_absente') } };
      if ('lien' in f)" "      if (f && 'lien' in f)" \
  "$EE"
prouver "un lien retiré dit qu'il n'y a pas de fichier" serveur/ventes/routes.ts \
  "      if ('lien' in f) return { statut: 404, corps: { motif: motif('espace.lien_invalide') } };
" "" \
  "$EE"
prouver "le bouton pour une pièce que la TTN n'a pas validée" web/public/espace/espace.js \
  "\${p.document.ttn ? '<button type=\"button\" id=\"efacture\"" "\${true ? '<button type=\"button\" id=\"efacture\"" \
  "$EV"
prouver "le bouton de la facture électronique ne fait rien" web/public/espace/espace.js \
  "    if (be) be.onclick = () => { void telechargerEfacture(p, be); };" "    if (be) be.onclick = () => {};" \
  "$EP"
prouver "la facture électronique téléchargée sans son nom" web/public/espace/espace.js \
  "    a.download = lu.nom;" "    a.download = '';" \
  "$EP"
prouver "un refus du serveur téléchargé comme un fichier" web/public/espace/espace.js \
  "    if (!r.ok) { dire(typeof lu.motif === 'string' ? lu.motif : 'Le fichier ne vient pas : réessaie dans un instant.'); return; }
    b.disabled = false;" "    b.disabled = false;" \
  "$EP"
prouver "une coupure du réseau sans un mot" web/public/espace/espace.js \
  "      r = await fetch('/v1/espace/efacture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jeton, type: p.type, numero: p.numero }) });
    } catch {
      dire('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.');
      return;
    }" "      r = await fetch('/v1/espace/efacture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jeton, type: p.type, numero: p.numero }) });
    } catch {
      return;
    }" \
  "$EP"
prouver "le bouton reste éteint après le téléchargement" web/public/espace/espace.js \
  "    b.disabled = false;
    const a = document.createElement('a');" "    const a = document.createElement('a');" \
  "$EP"

# Brique 140 : signer plusieurs pièces d'un coup depuis la liste (docs/facture-electronique.md, M).
SL="les pièces qui attendent leur signature, pour qui peut signer, et un seul code pour plusieurs (brique 140)"
SW="« Signer les 3 pièces en attente… » : un seul code les signe toutes, sans rien pousser à l'écran (brique 140)"
prouver "un commercial voit les pièces à signer" serveur/v10/routes.ts \
  "chemin: '/entreprises/:entreprise/efacture/a-signer', geste: 'ventes.facture.signer'," "chemin: '/entreprises/:entreprise/efacture/a-signer', geste: 'ventes.pieces.voir'," \
  "$SL"
prouver "une pièce signée encore proposée" serveur/v10/routes.ts \
  "and p.statut = 'emise' and g.piece is null order by e.ecrit_le limit 100" "and p.statut = 'emise' order by e.ecrit_le limit 100" \
  "$SL"
prouver "les plus récentes proposées d'abord" serveur/v10/routes.ts \
  "and g.piece is null order by e.ecrit_le limit 100" "and g.piece is null order by e.ecrit_le desc limit 100" \
  "$SL"
prouver "plus de 100 pièces dans une demande" serveur/v10/routes.ts \
  "and g.piece is null order by e.ecrit_le limit 100" "and g.piece is null order by e.ecrit_le limit 1000" \
  "$SL"
prouver "le compte limité aux pièces proposées" serveur/v10/routes.ts \
  "select p.ref_v10 cle, p.numero_texte numero, count(*) over () total" "select p.ref_v10 cle, p.numero_texte numero, 1 total" \
  "$SL"
prouver "un code demandé par pièce" web/public/plateforme/pont.js \
  "{ pieces: docs.map((x) => x.id) }" "{ pieces: [doc.id] }" \
  "$SW"
prouver "le bouton loin du titre" web/public/v10/app.js \
  "<span id=\"sg-a-signer\" style=\"margin-right:auto\"></span>" "<span id=\"sg-a-signer\"></span>" \
  "$SW"
prouver "le bouton sur la liste des devis" web/public/v10/app.js \
  "\${!isQ && bridge.dessinerASigner && company().efacture === true ?" "\${bridge.dessinerASigner && company().efacture === true ?" \
  "$SW"
prouver "le bouton dans une entreprise non soumise" web/public/v10/app.js \
  "\${!isQ && bridge.dessinerASigner && company().efacture === true ?" "\${!isQ && bridge.dessinerASigner ?" \
  "$SW"
prouver "le bouton jamais posé" web/public/v10/app.js \
  "    if (\$('#sg-a-signer')) void bridge.dessinerASigner(" "    if (false) void bridge.dessinerASigner(" \
  "$SW"
prouver "le refus d'un commercial casse la page" web/public/plateforme/pont.js \
  "    try { lu = await appel('GET', '/efacture/a-signer'); } catch { return; }" "    lu = await appel('GET', '/efacture/a-signer');" \
  "$SW"
prouver "signées, la liste garde son bouton" web/public/plateforme/pont.js \
  "          apres();
" "" \
  "$SW"
prouver "le bouton promet plus qu'une demande ne signe" web/public/plateforme/pont.js \
  "\${lu.total > n ? \`Signer les \${n} premières pièces en attente (sur \${lu.total})…\`
      : lu.total > 1" "\${lu.total > 1" \
  "$SW"
prouver "« Signer les 1 pièces »" web/public/plateforme/pont.js \
  ": lu.total > 1 ? \`Signer les \${lu.total} pièces en attente…\` : 'Signer la pièce en attente…'}" ": \`Signer les \${lu.total} pièces en attente…\`}" \
  "$SW"
prouver "la fenêtre ne dit pas quelles pièces elle signe" web/public/plateforme/pont.js \
  "\`Les fichiers El Fatoora de \${esc(docs.map((d) => d.number).join(', '))}, écrits" "\`Les fichiers El Fatoora, écrits" \
  "$SW"
prouver "signées, la fenêtre propose de télécharger un seul fichier" web/public/plateforme/pont.js \
  "        if (!telecharger) {" "        if (false) {" \
  "$SW"

# Brique 139 : l'état El Fatoora dans la liste des factures (docs/facture-electronique.md, L).
EL="la liste lit où en est chaque pièce, en un appel pour toute la page (brique 139)"
EW="chaque facture émise dit où en est son fichier El Fatoora, en un appel pour la page, sans rien pousser"
prouver "une pièce refusée dite retenue" serveur/v10/routes.ts \
  "x.statut === 'a_envoyer' && x.motif ? 'retenue' : x.statut" "x.motif ? 'retenue' : x.statut" \
  "$EL"
prouver "une pièce retenue dite en route" serveur/v10/routes.ts \
  "x.statut === 'a_envoyer' && x.motif ? 'retenue' : x.statut" "x.statut" \
  "$EL"
prouver "une pièce signée qui ne part pas dite à signer" serveur/v10/routes.ts \
  "!x.signe ? 'a_signer' : !x.statut ? 'signee'" "!x.statut ? 'a_signer'" \
  "$EL"
prouver "la liste lit les pièces d'une autre entreprise de la même personne" serveur/v10/routes.ts \
  "        where p.entreprise = \$1 and p.ref_v10 = any(\$2)\`, [params.entreprise, cles])" "        where \$1::uuid is not null and p.ref_v10 = any(\$2)\`, [params.entreprise, cles])" \
  "$EL"
prouver "les états d'autant de pièces qu'on veut" serveur/v10/routes.ts \
  "if (cles.length > 100) return" "if (cles.length > 1000) return" \
  "$EL"
prouver "la ligne grandit quand l'état arrive" web/public/plateforme/pont.js \
  ".ttn-etat { display: block; min-height: 1.4em; }" ".ttn-etat { display: block; }" \
  "$EW"
prouver "un appel par ligne" web/public/plateforme/pont.js \
  "    for (let i = 0; i < ids.length; i += 100) {
      const lot = ids.slice(i, i + 100);" "    for (let i = 0; i < ids.length; i += 1) {
      const lot = ids.slice(i, i + 1);" \
  "$EW"
prouver "chaque frappe redemande les états" web/public/plateforme/pont.js \
  "if (c && Date.now() - c.le < 20_000) poserEtat(el, c.e);" "if (false) poserEtat(el, c.e);" \
  "$EW"
prouver "la liste d'une entreprise non soumise montre l'état" web/public/v10/app.js \
  "bridge.etatsTtn && company().efacture === true && (d.type" "bridge.etatsTtn && (d.type" \
  "$EW"
prouver "la raison d'une pièce retenue tue" web/public/plateforme/pont.js \
  ": e.motif ? phrase(e.motif) :" ":" \
  "$EW"
prouver "une pièce refusée sans couleur d'alerte" web/public/plateforme/pont.js \
  "<span class=\"small \${m[1] ? 'warn-text' : 'muted'}\"" "<span class=\"small muted\"" \
  "$EW"
prouver "signée depuis sa fenêtre, la liste la dit encore à signer" web/public/plateforme/pont.js \
  "      const fini = (r, deja) => {
        for (const x of docs) etatsConnus.delete(x.id);" "      const fini = (r, deja) => {" \
  "$EW"
prouver "renvoyée depuis sa fenêtre, la liste la dit encore refusée" web/public/plateforme/pont.js \
  "renvoyer\`);
          etatsConnus.delete(doc.id);" "renvoyer\`);" \
  "$EW"
prouver "une coupure du réseau casse la page" web/public/plateforme/pont.js \
  "      } catch { /* sans réseau, la place reste vide : la liste se redessinera */ } finally {" "      } finally {" \
  "$EW"
prouver "les places jamais remplies" web/public/plateforme/pont.js \
  "    etatsTtn: remplirEtats,
" "" \
  "$EW"

# Brique 138 : la caisse imprime par l'agent local (docs/bureau.md, C).
TB="Nadia règle l'imprimante de son comptoir, encaisse en espèces (ticket et tiroir) puis par carte (ticket seul)"
prouver "le tiroir s'ouvre pour un ticket payé par carte" web/public/v10/app.js \
  "company().caisseLargeur, !!(e.caisse && e.caisse.mode === 'especes')))" "company().caisseLargeur, true))" \
  "$TB"
prouver "le ticket encaissé ne sort pas tout seul" web/public/v10/app.js \
  "          if (bridge.ticketEncaisse) {" "          if (bridge.ticketEncaisse && false) {" \
  "$TB"
prouver "réimprimer un ticket ouvre le tiroir" web/public/plateforme/pont.js \
  "const r = await bureau.imprimerTicket(html, rouleau(largeur), { tiroir: false });" "const r = await bureau.imprimerTicket(html, rouleau(largeur), { tiroir: true });" \
  "$TB"
prouver "sans imprimante, chaque encaissement se plaint" web/public/plateforme/pont.js \
  "    if (!(await bureau.imprimante())) return { ok: true };
" "" \
  "$TB"
prouver "l'échec d'impression dit un code au lieu d'une phrase" web/public/plateforme/pont.js \
  "{ ok: false, raison: \`Ticket encaissé, mais pas imprimé : \${phraseImprimante(r.raison)}.\` }" "{ ok: false, raison: r.raison }" \
  "$TB"
prouver "le réglage de l'imprimante propose d'enregistrer les Paramètres" web/public/plateforme/pont.js \
  "      for (const t of ['input', 'change']) el.addEventListener(t, (ev) => ev.stopPropagation());
    }
    /** @param {string} s */
    const champ = (s) => /** @type {HTMLInputElement} */ (el.querySelector(s));" "    }
    /** @param {string} s */
    const champ = (s) => /** @type {HTMLInputElement} */ (el.querySelector(s));" \
  "$TB"
prouver "l'imprimante proposée dans un navigateur" web/public/plateforme/pont.js \
  "...(/** @type {any} */ (window).skanfactBureau ? { dessinerImprimante, imprimerTicket: imprimerParAgent, ticketEncaisse } : {})," "...({ dessinerImprimante, imprimerTicket: imprimerParAgent, ticketEncaisse })," \
  "$TB"
prouver "l'essai ignore la largeur du rouleau" web/public/plateforme/pont.js \
  "const largeurCaisse = () => rouleau((/** @type {any} */ (window).__societe?.() ?? {}).caisseLargeur);" "const largeurCaisse = () => 80;" \
  "$TB"
prouver "une adresse oubliée ne montre pas son champ" web/public/plateforme/pont.js \
  "        champ(r.branchement === 'port' ? '#imp-chemin' : (r.hote ? '#imp-port' : '#imp-hote')).focus();
" "" \
  "$TB"
prouver "le panneau de l'imprimante jamais posé" web/public/v10/app.js \
  "        \${bridge.dessinerImprimante ? \`\${panneau('p-imprimante')}<div id=\"imprimante-panel\"></div></div>\` : ''}
" "" \
  "$TB"

# Brique 137 : la coque de bureau (docs/bureau.md, B).
CI="la page de SkanFact imprime un ticket entier, à la largeur du rouleau, puis la coupe et le tiroir quand on le demande"
CA="la fenêtre reste chez SkanFact ; une page d'ailleurs n'obtient rien de l'agent"
prouver "l'agent obéit à une page d'ailleurs" bureau/coque/principal.ts \
  "if (e.senderFrame?.origin !== ORIGINE) throw" "if (e.senderFrame?.origin === 'jamais') throw" \
  "$CA"
prouver "la coque suit un lien vers ailleurs" bureau/coque/principal.ts \
  "{ e.preventDefault(); dehors(url); }" "{ dehors(url); }" \
  "$CA"
prouver "la coque ouvre une fenêtre vers ailleurs" bureau/coque/principal.ts \
  "if (url === 'about:blank' || new URL(url, ADRESSE).origin === ORIGINE) return { action: 'allow' };" "return { action: 'allow' };" \
  "$CA"
prouver "la coque accorde les permissions" bureau/coque/principal.ts \
  "setPermissionRequestHandler((_w, _p, rappel) => rappel(false))" "setPermissionRequestHandler((_w, _p, rappel) => rappel(true))" \
  "$CA"
prouver "la fenêtre du ticket charge ce qu'on lui montre" bureau/coque/principal.ts \
  "rappel({ cancel: !d.url.startsWith('data:') })" "rappel({ cancel: false })" \
  "$CI"
prouver "le ticket coupé à la hauteur de la fenêtre" bureau/coque/principal.ts \
  "    w.setContentSize(points, hauteur);
" "" \
  "$CI"
prouver "le ticket dessiné sans l'agrandir au rouleau" bureau/coque/principal.ts \
  "const zoom = points / ((rouleau * 96) / 25.4);" "const zoom = 1;" \
  "$CI"
prouver "le tiroir s'ouvre sans qu'on le demande, par le passage" bureau/coque/preload.cjs \
  "tiroir: Boolean(options && options.tiroir)" "tiroir: true" \
  "$CI"
prouver "sans imprimante, la page croit le ticket imprimé" bureau/coque/principal.ts \
  "  if (!imprimante) return { ok: false, raison: 'sans_imprimante' };
  try {
    await envoyer(imprimante, ticket(" "  if (!imprimante) return { ok: true };
  try {
    await envoyer(imprimante, ticket(" \
  "$CI"
prouver "un réglage d'imprimante faux accepté" bureau/coque/principal.ts \
  "const p = reglage.nullable().safeParse(r);" "const p = z.any().safeParse(r);" \
  "$CI"

# Brique 136 : l'agent local, l'imprimante de tickets et le tiroir (docs/bureau.md, A).
AR="le raster au point près : une ligne noire, puis les deux bords ; une largeur qui ne tombe pas sur 8 se complète de blanc"
AB="par bandes de 128 lignes : une longue bande de papier ne déborde pas la mémoire des petites imprimantes"
AT="le ticket : remise à zéro, l'image, la coupe ; le tiroir seulement si on le demande"
AG="une capture d'écran (BGRA) ramenée au rouleau : 80 mm = 576 points, 58 mm = 384 ; le transparent est du papier"
AE="éteinte, trop lente, ou un chemin inconnu : l'échec dit lequel"
prouver "le point de gauche dans le bit faible" bureau/agent/escpos.ts \
  "(0x80 >> (x & 7))" "(0x01 << (x & 7))" \
  "$AR"
prouver "le seuil compté noir" bureau/agent/escpos.ts \
  "(gris[(y0 + y) * largeur + x] ?? 255) < seuil" "(gris[(y0 + y) * largeur + x] ?? 255) <= seuil" \
  "$AR"
prouver "une seule bande pour tout le ticket" bureau/agent/escpos.ts \
  "const BANDE = 128;" "const BANDE = 1_000_000;" \
  "$AB"
prouver "le tiroir s'ouvre à chaque ticket" bureau/agent/escpos.ts \
  "...(tiroir ? [TIROIR] : [])" "TIROIR" \
  "$AT"
prouver "l'impulsion du tiroir trop courte" bureau/agent/escpos.ts \
  "Uint8Array.of(ESC, 0x70, 0x00, 0x19, 0xfa)" "Uint8Array.of(ESC, 0x70, 0x00, 0x01, 0xfa)" \
  "$AT"
prouver "le transparent imprimé noir" bureau/agent/escpos.ts \
  "Math.round((l * a + 255 * (255 - a)) / 255)" "Math.round(l)" \
  "$AG"
prouver "le ticket annoncé imprimé sans attendre l'imprimante" bureau/agent/imprimante.ts \
  "s.on('connect', () => s.end(Buffer.from(octets), () => finir()));" "s.on('connect', () => { s.write(Buffer.from(octets)); finir(); });" \
  "$AE"
prouver "une imprimante éteinte dite trop lente" bureau/agent/imprimante.ts \
  "finir(new ImpressionImpossible('injoignable'" "finir(new ImpressionImpossible('trop_lente'" \
  "$AE"
prouver "un chemin inconnu dit refusé" bureau/agent/imprimante.ts \
  "code === 'ENOENT' ? 'chemin_inconnu' : 'refusee'" "'refusee'" \
  "$AE"

# Brique 135 : « Déconnecter » chez le partenaire coupe la clé dans SkanFact.
BDP="« Déconnecter » chez le partenaire coupe la clé ici : son secret et la clé, une clé qu'il a reçue, redemander sans risque"
prouver "déconnecter ne coupe rien" base/migrations/0068_deconnecter_partenaire.sql \
  "    update socle.cle_api set revoquee_le = now() where id = v_cle;
" "" \
  "$BDP"
prouver "déconnecter sans le secret du partenaire" serveur/partenaires.ts \
  "      if (!secretJuste(p, requete.headers.authorization)) return secretRefuse;
      const id = await" "      const id = await" \
  "$BDP"
prouver "un autre partenaire coupe la clé de SkanEcom" base/migrations/0068_deconnecter_partenaire.sql \
  "where a.partenaire = p_partenaire and k.empreinte = p_empreinte_cle" "where k.empreinte = p_empreinte_cle" \
  "$BDP"
prouver "le partenaire coupe une clé faite à la main" base/migrations/0068_deconnecter_partenaire.sql \
  "    from socle.autorisation_partenaire a join socle.cle_api k on k.id = a.cle_api
   where a.partenaire = p_partenaire and k.empreinte = p_empreinte_cle" "    from socle.cle_api k
   where k.empreinte = p_empreinte_cle" \
  "$BDP"
prouver "redemander la déconnexion est refusé" base/migrations/0068_deconnecter_partenaire.sql \
  "  if v_cle is null then return null; end if;" "  if v_cle is null or v_revoquee is not null then return null; end if;" \
  "$BDP"
prouver "la déconnexion sans trace" base/migrations/0068_deconnecter_partenaire.sql \
  "    perform socle.tracer(v_entreprise, 'socle.partenaire.deconnecter'" "    perform 1 where false and socle.tracer(v_entreprise, 'socle.partenaire.deconnecter'" \
  "$BDP"
prouver "une trace à chaque redemande" base/migrations/0068_deconnecter_partenaire.sql \
  "  if v_revoquee is null then" "  if true then" \
  "$BDP"
# Essayer SkanEcom de bout en bout sur le poste : un serveur d'essai admet un retour en http sur la machine elle-même.
BPP="un serveur d'essai admet un retour sur le poste en http (la console du partenaire lancée à côté) ; la production, jamais"
prouver "le serveur d'essai ne dit pas qu'il est d'essai" serveur/principal.ts \
  "'utf8'), { essai: environnement === 'test' })" "'utf8'))" \
  "$BPP"
prouver "un retour sur le poste refusé même à l'essai" serveur/partenaires.ts \
  'HTTPS.test(r) || (essai && POSTE.test(r))' 'HTTPS.test(r)' \
  "$BPP"
prouver "un retour sur le poste admis hors essai" serveur/partenaires.ts \
  'HTTPS.test(r) || (essai && POSTE.test(r))' 'HTTPS.test(r) || POSTE.test(r)' \
  "$BPP"
prouver "un nom qui se fait passer pour le poste admis" serveur/partenaires.ts \
  '(?::\d{1,5})?\/[^\s?#]*$/' '[^\s?#]*$/' \
  "$BPP"
prouver "un retour du poste avec ses paramètres admis" serveur/partenaires.ts \
  '(?::\d{1,5})?\/[^\s?#]*$/' '(?::\d{1,5})?\/\S*$/' \
  "$BPP"
prouver "l'heure d'une action dite à l'heure du navigateur, pas de Tunis" web/public/plateforme/pont.js \
  "{ timeZone: 'Africa/Tunis', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit'," "{ day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit'," \
  "$BSC"
# Tes appareils vivent dans Ton compte depuis le lot onboarding (compte.js, partagé avec le Cabinet).
prouver "Tes appareils qui datent en UTC" web/public/plateforme/compte.js \
  "toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis', day: '2-digit'" "toLocaleDateString('fr-FR', { day: '2-digit'" \
  "$BSC"

# ── Brique 142 : la limite d'appels par adresse sur les routes sans session (docs/mise-en-ligne.md, A) ──
LA1="une rafale passe, puis « trop d'appels » avec l'attente ; la seconde d'après, un appel repasse ; chaque adresse a son seau"
LA2="sans frontal déclaré, l'adresse écrite dans un en-tête ne compte pas ; derrière le frontal, c'est celle qu'il a vue"
LA3="la machine elle-même (ses outils, ses tests) n'est pas limitée"
LA4="les chiffres : 60 appels d'un coup, puis un par seconde ; le nombre de relais se règle, de 0 à 5"
LA5="le programme serveur, derrière un frontal déclaré : 60 demandes d'un visiteur passent, la suivante attend ; un autre visiteur passe"
prouver "les routes sans session jamais limitées" serveur/app.ts \
  "          if (v && !v.permis) {" "          if (false && v && !v.permis) {" \
  "$LA1"
prouver "le refus sans l'attente dans retry-after" serveur/app.ts \
  "            reponse.header('retry-after', String(v.attendreSecondes));
            return envoyer(429, { motif: v.attendreSecondes === 1 ? motif('porte." "            return envoyer(429, { motif: v.attendreSecondes === 1 ? motif('porte." \
  "$LA1"
prouver "un seul seau pour toutes les adresses" serveur/app.ts \
  "limiteurPublic.appel(requete.ip)" "limiteurPublic.appel('tous')" \
  "$LA1"
prouver "une seconde d'attente dite « 1 secondes »" serveur/app.ts \
  "v.attendreSecondes === 1 ? motif('porte.trop_de_demandes_une') : " "" \
  "$LA1"
prouver "la machine limitée comme un visiteur" serveur/app.ts \
  "MACHINE.has(requete.ip) ? null : limiteurPublic.appel(requete.ip)" "limiteurPublic.appel(requete.ip)" \
  "$LA3"
prouver "l'adresse écrite par le visiteur crue sans frontal déclaré" serveur/app.ts \
  "rang < relais" "true" \
  "$LA2"
prouver "le frontal déclaré jamais cru" serveur/app.ts \
  "rang < relais" "false" \
  "$LA2"
prouver "les chiffres de la limite par adresse changés" serveur/limites.ts \
  "LIMITES_PAR_ADRESSE: ReglageLimites = { capacite: 60, parSeconde: 1 }" "LIMITES_PAR_ADRESSE: ReglageLimites = { capacite: 60, parSeconde: 10 }" \
  "$LA4"
prouver "le serveur limité par autre chose que la limite par adresse" serveur/app.ts \
  "options.limiteurPublic ?? new Limiteur(LIMITES_PAR_ADRESSE)" "options.limiteurPublic ?? new Limiteur({ capacite: 1000, parSeconde: 1 })" \
  "$LA5"
prouver "le programme serveur oublie le frontal déclaré" serveur/principal.ts \
  ", { proxy: c.proxy });" ");" \
  "$LA5"
prouver "la production démarre sans dire ses relais" serveur/principal.ts \
  "  if (environnement === 'production' && env.SKANFACT_PROXY === undefined) throw" "  if (false) throw" \
  "$LA4"
prouver "un nombre de relais hors de 0 à 5 accepté" serveur/principal.ts \
  "!Number.isInteger(proxy) || proxy < 0 || proxy > 5" "proxy < 0" \
  "$LA4"

# ── Brique 143 : le suiveur installe la plus récente version vérifiée en vert (docs/mise-en-ligne.md, B) ──
SV1="d'un seul appel, chaque version : verte si sa vérification a réussi, rouge si elle a échoué, en attente si elle tourne ; la plus récente compte"
SV2="la plus récente qui est verte ; rien si celle qui tourne l'est déjà, ou si aucune plus récente ne l'est"
prouver "une vérification qui tourne prise pour réussie" exploitation/suivre.ts \
  "p.status !== 'completed' ? 'en_cours' : " "" \
  "$SV1"
prouver "une vérification annulée prise pour réussie" exploitation/suivre.ts \
  "p.conclusion === 'success' ? 'vert' : 'rouge'" "p.conclusion !== 'failure' ? 'vert' : 'rouge'" \
  "$SV1"
prouver "la plus ancienne vérification d'une version qui compte" exploitation/suivre.ts \
  "    if (verdicts.has(p.head_sha)) continue;" "" \
  "$SV1"
prouver "une version plus ancienne que celle qui tourne installée" exploitation/suivre.ts \
  "    if (v === enService) return null;" "" \
  "$SV2"
prouver "la plus ancienne verte installée, pas la plus récente" exploitation/suivre.ts \
  "  for (const v of versions) {" "  for (const v of [...versions].reverse()) {" \
  "$SV2"

# ── Brique 144 : la sauvegarde de la nuit, restaurée à part et comptée (docs/mise-en-ligne.md, C) ──
SA1="la base entière dans un fichier, restaurée à part et comptée, puis jetée ; les 14 dernières restent, rien d'autre ne bouge"
SA2="une restauration qui échoue se dit, et ce soir-là rien ne s'efface"
SA3="un fichier abîmé ne se restaure pas : « essayer » le dit"
SA4="un échec imprévu (la base introuvable) se dit aussi, jamais le « réussi » de la veille, et ne laisse pas de fichier"
prouver "les vieilles sauvegardes rangées avant d'avoir essayé la nouvelle" exploitation/sauvegarder.sh \
  'essayer
# Ranger|||do rm -f "$DOSSIER/$vieux"; done' '# Ranger|||do rm -f "$DOSSIER/$vieux"; done
essayer' \
  "$SA2"
prouver "une sauvegarde de moins que promis" exploitation/sauvegarder.sh \
  'tail -n +$((GARDER + 1))' 'tail -n +$((GARDER))' \
  "$SA1"
prouver "les sauvegardes d'une autre base rangées avec" exploitation/sauvegarder.sh \
  '-name "$BASE-*.dump"' '-name "*.dump"' \
  "$SA1"
prouver "la sauvegarde jamais restaurée" exploitation/sauvegarder.sh \
  'pg_restore --exit-on-error -d "$ESSAI" "$f" 2>&1' 'true' \
  "$SA1"
prouver "une restauration ratée dite réussie" exploitation/sauvegarder.sh \
  'ecrire false "la restauration a échoué' 'ecrire true "la restauration a échoué' \
  "$SA2"
prouver "la base restaurée laissée là" exploitation/sauvegarder.sh \
  '  requete postgres "drop database if exists \"$ESSAI\" with (force)" >/dev/null
  ecrire true' '  ecrire true' \
  "$SA1"
prouver "la base restaurée laissée là après un échec" exploitation/sauvegarder.sh \
  '    requete postgres "drop database if exists \"$ESSAI\" with (force)" >/dev/null
    ecrire false' '    ecrire false' \
  "$SA3"
prouver "les lignes restaurées pas comptées" exploitation/sauvegarder.sh \
  '"$lignes" "$migrations"' '"0" "$migrations"' \
  "$SA1"
prouver "les migrations restaurées pas comptées" exploitation/sauvegarder.sh \
  'MIGRATIONS="select count(*) from socle.migration"' 'MIGRATIONS="select 0"' \
  "$SA1"
prouver "un échec imprévu tu (le réussi de la veille reste)" exploitation/sauvegarder.sh \
  "trap 'ecrire false" ": 'ecrire false" \
  "$SA4"
prouver "le fichier à moitié écrit laissé là" exploitation/sauvegarder.sh \
  '[ "$MODE" = essayer ] || rm -f "$f"'"' ERR" "true' ERR" \
  "$SA4"
prouver "le fichier examiné jeté quand l'essai échoue" exploitation/sauvegarder.sh \
  '[ "$MODE" = essayer ] || rm -f "$f"' 'rm -f "$f"' \
  "$SA3"

# ── Brique 145 : le code QR du téléphone, et le premier code essayé (docs/mise-en-ligne.md, D) ──
CE1="la clé seule est celle de l'adresse du code QR ; le premier code juste passe, un faux est refusé avec sa raison ; l'essai ne change rien"
CE2="sans application posée, aucun code ne passe ; le code d'un autre non plus"
CEP="du compte à la facture émise par le serveur, retrouvée après rechargement, puis le retour d'un autre appareil"
prouver "n'importe quel code accepté à l'essai" serveur/routes/socle.ts \
  "      if (!await essayerCode(ctx, qui, corps.code)) throw new Refus('compte.code_essai_faux');" "" \
  "$CE1"
prouver "la clé seule jamais rendue" serveur/routes/socle.ts \
  'adresseApplication: r.adresseApplication, cle: r.secret }' 'adresseApplication: r.adresseApplication }' \
  "$CE1"
prouver "le code tapé avec son espace refusé" serveur/connexion.ts \
  "verifierTotp(secret, code.replace(/\s/g, ''), " "verifierTotp(secret, code, " \
  "$CE1"
prouver "le secret d'un code par SMS pris pour celui d'une application" base/migrations/0070_essayer_code.sql \
  "where u.id = socle.moi() and u.code_methode = 'application'" "where u.id = socle.moi()" \
  "$CE2"
# L'écran du code n'est plus montré qu'au comptable d'un cabinet (lot onboarding, 0076) : ses preuves visent son test ;
# le parcours de l'entreprise active le code dans Ton compte (compte.js, ses preuves à la fin de ce fichier).
CEC="les codes de secours se copient et se téléchargent"
prouver "l'écran qui laisse partir sans activer le code" web/src/ecrans/CodeRequis.tsx \
  "    const r = await g.api('POST', '/moi/code/activer', { code: essai });" "    pose(); return; const r = await g.api('POST', '/moi/code/activer', { code: essai });" \
  "$CEC"
prouver "le code faux refusé sans montrer son champ" web/src/ecrans/CodeRequis.tsx \
  "    if (r.corps.champ !== 'code') { setCodes(null); setGarde(false); setEssai(''); }
    g.refuser(refusDe(r));" "    if (r.corps.champ !== 'code') { setCodes(null); setGarde(false); setEssai(''); }
    g.refuser({ ...refusDe(r), champ: null });" \
  "$CEC"
prouver "la clé en clair qui n'est pas celle du code QR" web/src/ecrans/CodeRequis.tsx \
  '{parQuatre(codes.cle)}' '{parQuatre(codes.cle.slice(1))}' \
  "$CEC"
prouver "le lien qui n'ouvre pas l'application" web/src/ecrans/CodeRequis.tsx \
  'href={codes.adresse}' 'href="#"' \
  "$CEC"
prouver "un code QR qui ne dit pas l'adresse" web/src/ecrans/CodeRequis.tsx \
  "  q.addData(adresse);" "  q.addData(adresse.replace('SkanFact', 'Skan'));" \
  "$CEC"

# Le suiveur ne descend jamais sous lui-même (brique 143, complétée le 05/10/2026).
SV3="jamais une version d'avant le suiveur : un serveur neuf attend plutôt qu'une version vérifiée le porte"
prouver "une version d'avant le suiveur installée" exploitation/suivre.ts \
  "    if (!installable(v)) continue;" "" \
  "$SV3"

# Le serveur d'essai n'attend plus GitHub (décidé par Skander le 05/10/2026) ; la production l'attend toujours.
SV4="le serveur d'essai (« aucune ») prend la plus récente dès qu'elle est envoyée ; sinon, seulement une version verte"
prouver "le serveur d'essai qui attend quand même GitHub" exploitation/suivre.ts \
  "  if (verification === 'aucune') return async () => 'vert';" "" \
  "$SV4"
prouver "la production qui n'attend plus GitHub" exploitation/suivre.ts \
  "  if (verification === 'aucune') return async () => 'vert';" "  if (verification !== 'github') return async () => 'vert';" \
  "$SV4"

# ── L'accès de Claude au serveur (exploitation/acces.ts ; docs/mise-en-ligne.md, F ; demandé par Skander le 05/10/2026) ──
AC1="acceptée seulement bien signée, par une clé déclarée et non retirée, à l'heure, et jamais vue ; refusée sinon, avec sa raison"
AC2="la commande signée s'exécute et rend sa sortie, ses erreurs et son code, puis s'écrit au journal ; recopiée ou sans signature, elle est refusée sans s'exécuter"
AC3="une commande trop longue est arrêtée à son délai ; la santé du service se lit sans clé"
prouver "une commande exécutée sans vérifier sa signature" exploitation/acces.ts \
  "  if (!bonne) return { ok: false, statut: 401, raison: 'signature fausse' };" "" \
  "$AC1"
prouver "une clé retirée qui ouvre encore le serveur" exploitation/acces.ts \
  "c.id === d.cle && !c.retiree" "c.id === d.cle" \
  "$AC1"
prouver "une demande vieille ou datée du futur acceptée" exploitation/acces.ts \
  "  if (!Number.isFinite(t) || Math.abs(maintenant - t) > FENETRE_MS) return" "  if (!Number.isFinite(t)) return" \
  "$AC1"
prouver "une demande recopiée acceptée" exploitation/acces.ts \
  "  if (dejaVus.has(d.nonce)) return { ok: false, statut: 409, raison: 'demande déjà reçue' };" "" \
  "$AC1"
prouver "un nombre trop court pour être tiré au hasard accepté" exploitation/acces.ts \
  " || d.nonce.length < 16) {" ") {" \
  "$AC1"
prouver "le service qui oublie les demandes déjà reçues" exploitation/acces.ts \
  "      vus.set(v.demande.nonce, t + 2 * FENETRE_MS);" "" \
  "$AC2"
prouver "les commandes de Claude absentes du journal du serveur" exploitation/acces.ts \
  "        if (r.journal) {" "        if (false && r.journal) {" \
  "$AC2"
prouver "une commande qui ne s'arrête jamais" exploitation/acces.ts \
  "setTimeout(() => { depasse = true; p.kill('SIGKILL'); }, delai * 1000);" "setTimeout(() => undefined, delai * 1000);" \
  "$AC3"

# Le compte créé, connecté tout de suite (vu sur le vrai serveur le 05/10/2026 : l'adresse était à retaper).
prouver "le compte créé, mais l'adresse et le mot de passe à retaper" web/src/ecrans/Inscription.tsx \
  "      if (c.corps.etat === 'connecte' && c.corps.jeton) {" "      if (false && c.corps.etat === 'connecte' && c.corps.jeton) {" \
  "$CEP"

# La virgule est la décimale, quelle que soit la langue du navigateur (web/public/plateforme/virgule.js ; vu sur le vrai
# serveur le 05/10/2026 : « 38,475 » tapé dans un prix devenait 38 475).
VIR="« 2,5 » sacs à « 12,250 » tapés, « 1 250,500 » et « 2.075,250 » collés : la facture et le serveur les comptent tels quels"
prouver "la virgule d'un prix avalée par un navigateur réglé en anglais" web/public/v10/index.html \
  '  <script src="../plateforme/virgule.js"></script>' "" \
  "$VIR"
prouver "la virgule jetée au lieu de devenir le point décimal" web/public/plateforme/virgule.js \
  "replace(/[.,]/g, '') + '.' + texte.slice(i + 1));" "replace(/[.,]/g, '') + texte.slice(i + 1));" \
  "$VIR"
prouver "les champs de nombre que la correction ne regarde pas" web/public/plateforme/virgule.js \
  "el.type !== 'number') return;" "el.type !== 'text') return;" \
  "$VIR"
prouver "un nombre sans virgule réécrit quand même" web/public/plateforme/virgule.js \
  "    if (i < 0) return;" "" \
  "$VIR"
prouver "la virgule tapée gardée en plus du point" web/public/plateforme/virgule.js \
  "    e.preventDefault();" "" \
  "$VIR"
prouver "le point des milliers d'un nombre collé pris pour une décimale" web/public/plateforme/virgule.js \
  ".replace(/[.,]/g, '') + '.'" " + '.'" \
  "$VIR"

# Le registre des règles communes (base/regles-communes.ts ; vu sur le vrai serveur le 05/10/2026 : aucune facture ne
# s'émettait, « le timbre fiscal n'est pas renseigné »).
RC1="chaque règle que le serveur lit est au registre, en vigueur aujourd'hui et avec sa source"
RC2="une règle déjà posée ne se réécrit pas ; une loi nouvelle ferme l'ancienne et pose la suivante ; un lot refusé n'écrit rien"
prouver "le timbre absent du registre des règles" base/regles-communes.json \
  '"code": "timbre.facture",' '"code": "timbre.ailleurs",' \
  "$RC1"
prouver "une règle réécrite par une installation" base/regles-communes.ts \
  "      if (!deja.meme_valeur || deja.source !== r.source) throw" "      if (false) throw" \
  "$RC2"
prouver "la source d'une règle changée sans un mot" base/regles-communes.ts \
  "if (!deja.meme_valeur || deja.source !== r.source) throw" "if (!deja.meme_valeur) throw" \
  "$RC2"
prouver "un lot de règles refusé qui écrit à moitié" base/regles-communes.ts \
  "    await client.query('rollback');" "    await client.query('commit');" \
  "$RC2"
prouver "la date de fin d'une règle qui change encore" base/regles-communes.ts \
  "      } else if ((r.fin ?? null) !== deja.fin) {" "      } else if (false) {" \
  "$RC2"
prouver "la date du timbre manquant écrite comme la base la range" serveur/ventes/pieces.ts \
  "date: p.date_piece.split('-').reverse().join('/') }" "date: p.date_piece }" \
  "le contrôle passe avant le numéro : un refus ne troue jamais la série"

# La version au pied du menu (serveur/ecrans.ts, plateforme/pont.js ; vu sur le vrai serveur le 05/10/2026 : « vdev »).
prouver "la version du menu qui reste « vdev »" web/public/plateforme/pont.js \
  "    updateVersion: async () => ({ version: document.querySelector" "    updateVersionOubliee: async () => ({ version: document.querySelector" \
  "$CEP"
prouver "la page servie sans la version de son code" serveur/ecrans.ts \
  "return versionnee.slice(0, apres) + marque + annonces" "return versionnee.slice(0, apres) + annonces" \
  "$CEP"
prouver "le serveur qui ne sert pas la version de son code" serveur/principal.ts \
  "  servirLesEcrans(app, c.web, c.version);" "  servirLesEcrans(app, c.web);" \
  "$CEP"
prouver "la version donnée par l'environnement ignorée" serveur/principal.ts \
  "version: env.SKANFACT_VERSION ?? versionDuCode()," "version: versionDuCode()," \
  "$CEP"
VDC="le jour de l'envoi (l'année d'abord) et le début de son empreinte ; « dev » sans dépôt"
prouver "la version écrite comme un jour de la base" serveur/ecrans.ts \
  "jour.replaceAll('-', '.')" "jour" \
  "$VDC"
prouver "la version sans l'empreinte de l'envoi" serveur/ecrans.ts \
  ' · ${court}`' '`' \
  "$VDC"

# Le fond de caisse proposé à l'ouverture : ce que le tiroir contient déjà (vu sur le vrai serveur le 05/10/2026 : la
# caisse créée avec 50 DT s'ouvrait à 0).
CZF="Sami ferme la caisse : le Z dit qu'il l'a fermée, s'imprime, et se relit parmi les Z passés"
prouver "la caisse qui s'ouvre à 0 alors que le tiroir a son fond" web/public/v10/app.js \
  'id="cs-fond" placeholder="0" value="${h(fondPropose)}"' 'id="cs-fond" placeholder="0"' \
  "$CZF"
prouver "le fond proposé qui ne lit pas le compte de caisse" web/public/v10/app.js \
  "const dansLeTiroir = idCaisse ? C.accountBalance(data, company(), idCaisse, C.today()).balance : 0;" "const dansLeTiroir = 0;" \
  "$CZF"

# Les nouveautés de la v10 (l'application de bureau) jamais montrées sur la plateforme (vu sur le vrai serveur le
# 05/10/2026 : « Nouveau dans SkanFact 10.15.0 » chez qui avait retenu « vdev »).
NV10="un navigateur qui avait retenu « vdev » voit la version du code, et aucune nouveauté de la v10"
prouver "les nouveautés de l'application de bureau montrées en ligne" web/public/v10/app.js \
  "typeof Nouveautes !== 'undefined' && !bridge.sansNouveautesV10 && Nouveautes.presenter({" "typeof Nouveautes !== 'undefined' && Nouveautes.presenter({" \
  "$NV10"
prouver "le point de contact qui laisse passer les nouveautés de la v10" web/public/plateforme/pont.js \
  "    sansNouveautesV10: true," "    sansNouveautesV10: false," \
  "$NV10"

# Le premier article créé depuis une caisse vide (vu sur le vrai serveur le 05/10/2026 : « Nouvelle prestation »).
CPA="« + Nouvel article » ouvre « Nouvel article » ; tapé « 12,500 » HT, il arrive dans la caisse à 14,875 DT"
prouver "la caisse qui ouvre une « Nouvelle prestation »" web/public/v10/app.js \
  "catalogForm(null, () => vers('#/caisse')(), { titre: 'Nouvel article' });" "catalogForm(null, () => vers('#/caisse')());" \
  "$CPA"
prouver "le prix d'un article tapé avec la virgule, avalé" web/public/v10/index.html \
  '  <script src="../plateforme/virgule.js"></script>' "" \
  "$CPA"

# Le comptoir après le parcours de la caisse sur le vrai serveur (05/10/2026 ; web/v10/comptoir.txt, dates.js).
# Les dates JJ/MM/AAAA quelle que soit la langue du navigateur (la péremption s'affichait « mm/dd/yyyy »).
DAT="la péremption s'affiche et se tape JJ/MM/AAAA ; une date impossible se voit ; le jour enregistré est le bon"
prouver "les dates du navigateur laissées à la langue du navigateur" web/public/v10/index.html \
  '  <script src="../plateforme/dates.js"></script>' "" \
  "$DAT"
prouver "un champ de date du navigateur que la correction ne regarde pas" web/public/plateforme/dates.js \
  "if (noeud.nodeType !== 1) return;" "return;" \
  "$DAT"
prouver "le mois lu avant le jour" web/public/plateforme/dates.js \
  "const j = Number(m[1]), mo = Number(m[2])," "const j = Number(m[2]), mo = Number(m[1])," \
  "$DAT"
prouver "une date impossible qui ne se voit pas" web/public/plateforme/dates.js \
  "const faux = Boolean(tape) && !lu;" "const faux = false;" \
  "$DAT"
prouver "le code de l'écran qui lit le jour affiché au lieu du jour ISO" web/public/plateforme/dates.js \
  "get() { return versIso(natif.get.call(this)); }," "get() { return natif.get.call(this); }," \
  "$DAT"
prouver "le jour enregistré affiché à l'envers" web/public/plateforme/dates.js \
  "natif.set.call(el, versJour(iso));" "natif.set.call(el, iso);" \
  "$DAT"
prouver "le jour tapé sans barres laissé tel quel" web/public/plateforme/dates.js \
  "      if (lu) natif.set.call(el, versJour(lu));" "" \
  "$DAT"
CAB="un abonnement créé, ses mois dus générés au brouillard une seule fois, puis suspendu"
prouver "les dates du Cabinet laissées à la langue du navigateur" web/public/v10/cabinet/index.html \
  '  <script src="../../plateforme/dates.js"></script>' "" \
  "$CAB"

# Le prix de l'étiquette, TTC (4,200 HT arrivait à 4,998 en caisse, jamais aux 5,000 de l'étiquette) ; la marge sans
# « prestation ».
TTC="le prix TTC de l'étiquette donne le HT ; la TVA changée ne bouge pas l'étiquette ; la caisse affiche 5,000 DT"
prouver "le TTC tapé recopié comme HT" web/public/v10/app.js \
  "          champHt.value = String(r.ht);" "          champHt.value = String(r.ttc);" \
  "$TTC"
prouver "le prix de l'étiquette qui bouge quand la TVA change" web/public/v10/app.js \
  "champTva.addEventListener('change', () => { if (tapeTtc && champTtc.value !== '') majHt(true); else majTtc(); });" "champTva.addEventListener('change', () => { majTtc(); });" \
  "$TTC"
prouver "un prix TTC inatteignable arrondi sans un mot" web/public/v10/app.js \
  "if (dire && !r.exact) toast(" "if (false) toast(" \
  "$TTC"
prouver "le TTC qui ne suit pas le HT tapé" web/public/v10/app.js \
  "champTtc.value = ht > 0 ? String(" "champTtc.value = ht < 0 ? String(" \
  "$TTC"
prouver "le prix TTC enregistré sur l'article, en plus de son HT et de sa TVA" web/public/v10/app.js \
  '<input type="number" id="cat-ttc"' '<input type="number" name="prixTtc" id="cat-ttc"' \
  "$TTC"
prouver "la marge d'une « prestation » chez qui vend des marchandises" web/public/v10/app.js \
  "la marge ne pourra pas se calculer." "la marge de cette prestation ne sera pas calculable." \
  "$TTC"

# Le bilan du jour et le Z disent les retours et le net (« Ventes TTC » restait brut ; le Z ne citait pas l'avoir).
prouver "le net du jour qui ne déduit pas les retours" web/public/v10/core.js \
  "net: round3(round3(total) - round3(retoursTtc))," "net: round3(total)," \
  "$CTW"
prouver "les retours du jour que le bilan ne compte pas" web/public/v10/core.js \
  "const avoirs = docs.filter(d => d.type === 'avoir' && d.date === j && d.status !== 'brouillon' && idsTickets.has(d.creditOf));" "const avoirs = [];" \
  "$CTW"
prouver "le bilan qui annonce des ventes brutes après un retour" web/public/v10/app.js \
  "\${C.money(b.retours ? b.net : b.total, cur)}" "\${C.money(b.total, cur)}" \
  "$CTW"
prouver "le bilan qui ne dit pas que les retours sont déduits" web/public/v10/app.js \
  "\${b.retours ? 'Ventes du jour, retours déduits' : 'Ventes TTC'}" "\${'Ventes TTC'}" \
  "$CTW"
prouver "le bilan imprimé sans ses retours" web/public/v10/core.js \
  "\${bilan.retours ? \`<tr><td>Retours (" "\${false ? \`<tr><td>Retours (" \
  "$CTW"
prouver "le Z à l'écran qui ne cite pas ses retours" web/public/v10/app.js \
  "\${(z.avoirs || []).length ? ligne(\`Retours : \${z.avoirs.map(a => \`\${h(a.numero)}" "\${false ? ligne(\`Retours : \${z.avoirs.map(a => \`\${h(a.numero)}" \
  "$CTW"
prouver "le Z imprimé qui ne cite pas ses retours" web/public/v10/core.js \
  "\${(z.avoirs || []).length ? ligne(\`Retours : \${z.avoirs.map(a => escapeHtml(a.numero))" "\${false ? ligne(\`Retours : \${z.avoirs.map(a => escapeHtml(a.numero))" \
  "$CTW"
prouver "le Z figé sans ses avoirs" serveur/caisse/routes.ts \
  "        avoirs: z0.avoirs.map((a) => ({ numero: a.numero, ticket: a.ticket, montant: texte(a.montant) }))," "        avoirs: []," \
  "$CT"
prouver "le net des ventes du Z qui ne déduit pas les retours" serveur/caisse/routes.ts \
  "net: BigInt(tot.total) - retoursTtc," "net: BigInt(tot.total)," \
  "$CT"
prouver "la TVA nette du Z qui garde celle des retours" serveur/caisse/routes.ts \
  "tvaNette: BigInt(tot.tva) - retoursTva" "tvaNette: BigInt(tot.tva)" \
  "$CT"
prouver "les avoirs du Z dans le désordre" serveur/caisse/routes.ts \
  "where r.session = \$1 order by r.cree_le, a.numero_texte" "where r.session = \$1 order by a.numero_texte desc" \
  "$CT"

# ── La caisse tactile (05/10/2026 ; maquette validée par Skander ; web/v10/caisse-tactile.txt, caisse.css ; docs/caisse.md) ──
TAC="au comptoir : familles, douchette, article libre, attente, annulation, écran du client, monnaie ; le soir, le comptage billet par billet"
TACT="au téléphone : le ticket se replie sous les tuiles, et le tiroir se compte par un pavé dans une fenêtre"
TACZ="un détail qui fait le total se garde dans le Z ; un détail faux est refusé, rien n'est fermé"
TEL="les pages du quotidien de la v10, sur un téléphone et un ordinateur : aucune ne défile de côté, rien ne sort de l'écran, et au doigt tout se touche"
TB="Nadia règle l'imprimante de son comptoir, encaisse en espèces (ticket et tiroir) puis par carte (ticket seul)"
prouver "les familles du Catalogue absentes de la caisse" web/public/v10/app.js \
  "const familles = [...new Set(articles.map(a => String(a.famille || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));" "const familles = [];" \
  "$TAC"
prouver "la douchette qui n'ajoute pas l'article scanné" web/public/v10/app.js \
  "        if (liste.length === 1) { scanIn.value = ''; s.q = ''; ajouter(liste[0]); drawFamilles(); drawArticles(); }" "        if (false) { scanIn.value = ''; s.q = ''; ajouter(liste[0]); drawFamilles(); drawArticles(); }" \
  "$TAC"
prouver "l'article libre au prix arrondi sans un mot" web/public/v10/app.js \
  "            if (!r.exact) toast(\`Aucun prix HT ne donne exactement" "            if (false) toast(\`Aucun prix HT ne donne exactement" \
  "$TAC"
prouver "la vente mise en attente, perdue" web/public/v10/app.js \
  "        s.attente = (s.attente || []).concat([{ panier: s.panier, remise: s.remise, clientId: s.clientId, le: Date.now() }]);" "        s.attente = s.attente || [];" \
  "$TAC"
prouver "la vente reprise qui efface le ticket en cours" web/public/v10/app.js \
  "            if (s.panier.length) l.push({ panier: s.panier, remise: s.remise, clientId: s.clientId, le: Date.now() });
" "" \
  "$TAC"
prouver "le ticket annulé sans retour en arrière" web/public/v10/app.js \
  "          toastUndo('Ticket annulé.', () => { Object.assign(s, avant); drawTicket(); drawArticles(); });" "          toast('Ticket annulé.');" \
  "$TAC"
prouver "l'écran du client qui, ouvert, ne sait pas ce que la caisse montre" web/public/v10/app.js \
  "canalClient.onmessage = m => { if (m.data && m.data.demande && pourLeClient) canalClient.postMessage(pourLeClient); };" "canalClient.onmessage = null;" \
  "$TAC"
prouver "l'écran du client qui ne suit pas le paiement" web/public/v10/app.js \
  "      ecranClient('paiement', { recu:" "      ecranClient('vente', { recu:" \
  "$TAC"
prouver "un montant tapé après un billet, ajouté au billet" web/public/v10/app.js \
  "          let v = s.recuNeuf ? '' : s.recu || '';" "          let v = s.recu || '';" \
  "$TAC"
prouver "la douchette perdue sur l'écran de la monnaie" web/public/v10/app.js \
  "    if (\$('#cs-rendu-ecran') && \$('#cs-nouvelle')) \$('#cs-nouvelle').click();
" "" \
  "$TAC"
prouver "le comptage du tiroir qui ne part pas au serveur" web/public/plateforme/pont.js \
  "...(comptage && comptage.length ? { comptage } : {})" "...({})" \
  "$TAC"
prouver "le Z à l'écran sans le détail du comptage" web/public/v10/app.js \
  "        \${(z.comptage || []).map(x => ligne(" "        \${([]).map(x => ligne(" \
  "$TAC"
prouver "le Z imprimé sans le détail du comptage" web/public/v10/core.js \
  "\${(z.comptage || []).map(x => ligne(\`&nbsp;&nbsp;" "\${([]).map(x => ligne(\`&nbsp;&nbsp;" \
  "$TAC"
prouver "une coupure comptée que le lecteur d'écran ne dit pas" web/public/v10/app.js \
  "          b.setAttribute('aria-label', \`\${libelle(i)} : \${n}\`);
" "" \
  "$TAC"
prouver "un détail du comptage faux, accepté" serveur/caisse/routes.ts \
  "      if (comptage.length && somme !== compte) {" "      if (false) {" \
  "$TACZ"
prouver "le détail du comptage oublié par le Z" serveur/caisse/routes.ts \
  "        ...(comptage.length ? { comptage: comptage.map((c) => ({ valeur: texte(c.valeur), nombre: c.nombre, total: texte(c.total) })) } : {}),
" "" \
  "$TACZ"
prouver "le refus du comptage qui écrit les montants à l'anglaise" serveur/caisse/routes.ts \
  "somme: versTexte(somme, decimales).replace('.', ',')" "somme: versTexte(somme, decimales)" \
  "$TACZ"
prouver "le comptage au téléphone sans pavé à portée" web/public/v10/app.js \
  "        if (!window.matchMedia('(max-width: 920px)').matches) return;" "        return;" \
  "$TACT"
prouver "le nombre de billets qui accepte une virgule" web/public/v10/app.js \
  "PAVE.map(k => (o.entier && k === ',' ? '<span aria-hidden=\"true\"></span>' : touche(k)))" "PAVE.map(touche)" \
  "$TACT"
prouver "le ticket replié du téléphone qui garde ses boutons" web/public/plateforme/caisse.css \
  ".ct-ticket:not(.ouvert) .ct-pas, " "" \
  "$TACT"
prouver "les lignes repliées sans leur quantité" web/public/plateforme/caisse.css \
  "  .ct-ticket:not(.ouvert) .ct-q { display: inline; }
" "" \
  "$TACT"
prouver "la barre du comptage sur trois lignes au téléphone" web/public/plateforme/caisse.css \
  "  .ct-tete:has(#cs-revenir-vente) .ct-nom { display: none; }
" "" \
  "$TACT"
prouver "le mode de paiement de la caisse trop petit pour un doigt" web/public/plateforme/caisse.css \
  ".ct-corps .ct-mode { height: 64px; min-height: 64px;" ".ct-corps .ct-mode { height: 30px; min-height: 0;" \
  "$TACT"
prouver "le « + » de l'article libre trop étroit pour un doigt au téléphone" web/public/plateforme/caisse.css \
  "min-height: 44px; min-width: 44px; padding: 0 14px;" "min-height: 44px; padding: 0 14px;" \
  "$TEL"
prouver "la barre de la caisse sous le bandeau du poste" web/public/plateforme/caisse.css \
  "height: calc(100vh - var(--poste-bandeau-h, 0px)); margin-top: var(--poste-bandeau-h, 0px);" "height: 100vh; margin-top: 0;" \
  "$CHW"
prouver "la caisse revenue d'une autre page, encore sur la monnaie de la vente d'avant" web/public/v10/app.js \
  "    if (s.ecran === 'rendu' && !\$('#cs-body')) s.ecran = 'vente';
" "" \
  "$TB"

# ── Le lot achats (05/10/2026 ; le parcours d'un commerçant à la souris ; web/v10/achats-lot.txt, ecrans.css ; docs/achats.md) ──
ACW1="Nadia commande, reçoit en deux fois, saisit et règle la facture, en tire un avoir, lit une facture en photo"
ACW2="une demande de prix sans prix s'envoie d'abord ; le retour d'une liste de prix répond"
ACS1="une commande en brouillon ou une demande de prix ne reçoit rien, propriétaire compris ; partie, ou partant avec sa réception, elle reçoit"
prouver "le bouton retour de la réception qui ne répond pas" web/public/v10/app.js \
  "    go(() => goBack(b.dataset.retour || undefined, b.dataset.saut || undefined));
" "" \
  "$ACW1"
prouver "l'unité « Autre… » d'une commande qui n'ouvre pas la saisie libre" web/public/v10/app.js \
  "      \$\$('#cf-lines select[data-k=unit]').forEach(sel => bindUnitSelect(" "      [].forEach(sel => bindUnitSelect(" \
  "$ACW1"
prouver "« Autre… » perdu pendant une recherche dans une liste" web/public/v10/listes.js \
  ".concat(lignes.filter(x => x.libre))" "" \
  "$ACW1"
prouver "la recherche d'une liste qui range « demi-journée » avant « mois »" web/public/v10/listes.js \
  ".map((x, k) => ({ x, k, r: rang(x.label) })).sort((a, b) => b.r - a.r || a.k - b.k).map(a => a.x)" "" \
  "$ACW1"
prouver "la saisie libre d'une unité qui arrive vide" web/public/v10/app.js \
  "promptDialog('Unité personnalisée', 'Unité (ex : rouleau, palette, ml)', saisi, v => {" "promptDialog('Unité personnalisée', 'Unité (ex : rouleau, palette, ml)', '', v => {" \
  "$ACW1"
prouver "« Autre : … » choisi sans emporter la frappe" web/public/v10/listes.js \
  "      if (x.libre) { const f = q ? q.value.trim() : ''; if (f) cible.dataset.saisie = f; else delete cible.dataset.saisie; }
" "" \
  "$ACW1"
prouver "une ligne relue avec « __autre__ » pour unité" web/public/v10/app.js \
  "    if (value === UNIT_OTHER) value = '';
" "" \
  "$ACW2"
prouver "les unités déjà employées absentes d'une ligne de commande" web/public/v10/app.js \
  "\${unitOptions(l.unit, unitesCommande())}" "\${unitOptions(l.unit)}" \
  "$ACW1"
prouver "« Mati » qui propose d'abord ce qui le contient" web/public/v10/app.js \
  "        shown = shown.map((x, k) => ({ x, k, r: C.rangRecherche(x.label || '', q.value) + entier(x) })).sort((a, b) => b.r - a.r || a.k - b.k).map(a => a.x);
" "" \
  "$ACW1"
prouver "« 118 » qui choisit FA-2026/1187" web/public/v10/app.js \
  "C.rangRecherche(x.label || '', q.value) + entier(x)" "C.rangRecherche(x.label || '', q.value)" \
  "$ACW1"
prouver "la catégorie créée qui ne paraît pas dans le champ" web/public/v10/app.js \
  "        \$('[data-combo=category]', head).setItems(C.expenseCategories(data).map(c => ({ v: c, label: c })), v);" "        bindCombo(\$('[data-combo=category]', head), { items: C.expenseCategories(data).map(c => ({ v: c, label: c })), placeholder: '— Choisir une catégorie —' }).setValue(v);" \
  "$ACW1"
prouver "« Achats de matières premières » absente des catégories" web/public/v10/core.js \
  "'Achats de marchandises', 'Achats de matières premières', 'Sous-traitance'" "'Achats de marchandises', 'Sous-traitance'" \
  "$ACW1"
prouver "la réception qui dit la marchandise entrée en stock quand rien n'est suivi" web/public/v10/app.js \
  "toast(\`Réception \${r.number} validée : \${phraseStockReception(r)}\`)" "toast(\`Réception \${r.number} validée : la marchandise suivie est entrée en stock.\`)" \
  "$ACW1"
prouver "le bandeau de la facture qui affirme la marchandise entrée sans la compter" web/public/v10/app.js \
  "\${phraseReceptionsAchat(p.receptions)}." "sa marchandise est déjà entrée en stock par \${p.receptions.length > 1 ? 'elles' : 'elle'}, ces lignes ne l'y font pas entrer une seconde fois." \
  "$ACW1"
prouver "« Recevoir » qui laisse la commande en brouillon" web/public/v10/app.js \
  "        cmdR.status = 'envoyée';
" "" \
  "$ACW1"
prouver "une commande qui a reçu, remise en brouillon" web/public/v10/app.js \
  ".filter(s => !recue || s === o.status || !['demande', 'brouillon'].includes(s))" "" \
  "$ACW1"
prouver "le serveur qui valide une réception sur une commande pas partie" serveur/v10/dossier.ts \
  "    await controlerReceptions(tx, entreprise, lus);
" "" \
  "$ACS1"
prouver "une réception validée sur une demande de prix" serveur/v10/accords.ts \
  "    if (statut !== 'brouillon' && statut !== 'demande') continue;" "    if (statut !== 'brouillon') continue;" \
  "$ACS1"
prouver "« Recevoir » refusé : la commande qui part dans le même envoi n'est pas lue" serveur/v10/accords.ts \
  "    const dansLEnvoi = lus.find((x) => x.collection === 'supplierOrders' && x.cle === id);" "    const dansLEnvoi = undefined as { apres: unknown } | undefined;" \
  "$ACS1"
prouver "l'invitation posée sur le premier champ de la page" web/public/v10/app.js \
  "      if (!document.body.classList.contains('mode-caisse')) { el.classList.add('ga-coin'); bouton.classList.add('guide-moi-signale'); return; }
" "" \
  "$ACW1"
prouver "l'invitation qui ne va pas dans le coin" web/public/plateforme/ecrans.css \
  ".guide-appel.ga-coin { right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }" "" \
  "$ACW1"
prouver "« Guide-moi » qui reste allumé quand l'invitation s'en va" web/public/v10/app.js \
  "      bouton.classList.remove('guide-moi-signale');
" "" \
  "$ACW1"
prouver "« la déclaration de août »" web/public/v10/app.js \
  "avec la déclaration \${C.deLibelle(C.MONTHS_FR[Number(d0.slice(5, 7)) - 1] + ' ' + d0.slice(0, 4))}, et tu" "avec la déclaration de \${C.MONTHS_FR[Number(d0.slice(5, 7)) - 1]} \${d0.slice(0, 4)}, et tu" \
  "$ACW1"
prouver "l'attestation de retenue sans dire où elle s'établit" web/public/v10/app.js \
  "au fournisseur ; elle s'établit sur TEJ, la plateforme du ministère des Finances. <em>À VÉRIFIER avec ton comptable.</em>" "au fournisseur." \
  "$ACW1"
prouver "« Joindre un justificatif » proposé en ligne, où il refuse toujours" web/public/v10/app.js \
  "\${bridge.piecesJointes === false ? '' : \`<span class=\"colle-bouton\"><button class=\"btn\" id=\"attach-top\">" "\${false ? '' : \`<span class=\"colle-bouton\"><button class=\"btn\" id=\"attach-top\">" \
  "$ACW1"
prouver "le bouton du justificatif absent, branché quand même" web/public/v10/app.js \
  "    if (\$('#attach-top')) \$('#attach-top').onclick = async () => {" "    \$('#attach-top').onclick = async () => {" \
  "$ACW1"
prouver "le filtre « Sans justificatif » proposé en ligne" web/public/v10/app.js \
  "\${bridge.piecesJointes === false && s.st !== SANS_JUSTIF ? '' :" "\${false ? '' :" \
  "$ACW1"
prouver "la clôture qui réclame des justificatifs qu'on ne peut pas joindre" web/public/v10/core.js \
  "const noProof = opts && opts.sansPiecesJointes ? [] : (data.purchases" "const noProof = (data.purchases" \
  "$ACW1"
prouver "la page de clôture qui ne dit pas qu'on ne peut pas joindre" web/public/v10/app.js \
  "const checks = next ? C.closureChecks(data, company(), next.from, next.to, { reserves: licence.reserves || [], sansPiecesJointes: bridge.piecesJointes === false }) : [];" "const checks = next ? C.closureChecks(data, company(), next.from, next.to, { reserves: licence.reserves || [] }) : [];" \
  "$ACW1"
prouver "l'étape du justificatif qui attend un bouton absent" web/public/v10/visites.js \
  "titre: 'Le justificatif d\\'abord', facultatif: true," "titre: 'Le justificatif d\\'abord'," \
  "dans « Saisir une facture d'achat », l'étape du justificatif, absent en ligne, est facultative"
prouver "l'objet d'un avoir qui invite à dire ce qu'on a acheté" web/public/v10/app.js \
  "        if (objet) objet.placeholder = inviteObjet(p.kind);
" "" \
  "$ACW1"
prouver "l'échéance d'un avoir" web/public/v10/app.js \
  "      if (bloc) bloc.hidden = p.kind === 'avoir';" "      if (bloc) bloc.hidden = false;" \
  "$ACW1"
prouver "l'avoir rattaché depuis la liste qui ne reprend rien" web/public/v10/app.js \
  "        if (vise && isNew && p.kind === 'avoir' && !(p.lines || []).some(" "        if (false && vise && isNew && p.kind === 'avoir' && !(p.lines || []).some(" \
  "$ACW1"
prouver "« Tu as modifié cette facture d'achat » dit d'un avoir" web/public/v10/app.js \
  "p.kind === 'avoir' ? 'cet avoir' : p.kind === 'acompte' ? 'cet acompte'" "p.kind === 'avoir' ? 'cette dépense' : p.kind === 'acompte' ? 'cet acompte'" \
  "$ACW1"
prouver "« Enregistrer » qu'en haut d'un long achat" web/public/v10/app.js \
  "\${clos ? '' : '<div class=\"save-bar\" id=\"b-save-bar\" hidden>" "\${true ? '' : '<div class=\"save-bar\" id=\"b-save-bar\" hidden>" \
  "$ACW1"
prouver "deux « Enregistrer » principaux à l'écran" web/public/v10/app.js \
  "majBarre = () => { const b = \$('#b-save-bar'); if (b) b.hidden = !(dirty && !hautEnVue); };" "majBarre = () => { const b = \$('#b-save-bar'); if (b) b.hidden = !dirty; };" \
  "$ACW1"
prouver "l'échéance qui reste vide après une lecture" web/public/v10/app.js \
  "      if (!p.dueDate && p.date && p.kind !== 'depense' && p.kind !== 'avoir') p.dueDate = C.addDays(p.date, delaiAchat(p.supplierId));
" "" \
  "$ACW1"
prouver "la fiche du fournisseur à 1366 px : la liste à côté des coordonnées, ses montants coupés" web/public/plateforme/ecrans.css \
  "  .dash-grid:has(#sup-docs) { grid-template-columns: 1fr; }
" "" \
  "$ACW1"
prouver "la feuille des réglages d'écran de la plateforme oubliée" web/public/v10/index.html \
  "  <link rel=\"stylesheet\" href=\"../plateforme/ecrans.css\">
" "" \
  "$ACW1"
prouver "la demande de prix qui affiche un total à zéro" web/public/v10/app.js \
  "      if (o.status === 'demande' && !o.lines.some(l => Number(l.unitPrice) > 0)) {" "      if (false) {" \
  "$ACW2"
prouver "« Commander » en bouton principal avant l'envoi de la demande" web/public/v10/app.js \
  "<button class=\"btn \${demandeSansPrix ? '' : 'btn-primary'}\" id=\"cf-commander\">" "<button class=\"btn btn-primary\" id=\"cf-commander\">" \
  "$ACW2"
prouver "le PDF d'une demande sans prix qui n'est pas l'étape suivante" web/public/v10/app.js \
  "<button class=\"btn \${demandeSansPrix ? 'btn-primary' : ''}\" id=\"cf-pdf\">" "<button class=\"btn\" id=\"cf-pdf\">" \
  "$ACW2"
prouver "« Commande … enregistrée » dit d'une demande de prix" web/public/v10/app.js \
  "toast(\`\${o.status === 'demande' ? 'Demande de prix' : 'Commande'} \${o.number} enregistrée\`);" "toast(\`Commande \${o.number} enregistrée\`);" \
  "$ACW2"
prouver "la colonne des prix d'une demande qui dit « P.U. HT »" web/public/v10/app.js \
  "\${quoi === 'demande' ? 'Prix répondu HT' : 'P.U. HT'}" "P.U. HT" \
  "$ACW2"
prouver "la date d'une commande sans sa bulle « i »" web/public/v10/guide.js \
  "    'cf.date': { t: 'Date'," "    'cf.date-retiree': { t: 'Date'," \
  "$ACW1"
prouver "la référence d'une commande sans sa bulle « i »" web/public/v10/app.js \
  "lbl('Référence (optionnel)', 'cf.reference')" "lbl('Référence (optionnel)', '')" \
  "$ACW1"
prouver "la désignation d'une commande écrasée par les autres colonnes" web/public/v10/app.js \
  "<th class=\"r\" style=\"width:76px\">Qté</th><th style=\"width:136px\">Unité</th><th class=\"r\" style=\"width:124px\">" "<th class=\"r\">Qté</th><th>Unité</th><th class=\"r\">" \
  "$ACW1"

# ── L'exemple rempli, et « Faire une facture » pas à pas (retour de Skander, 05/10/2026 ; serveur/v10/exemple.ts,
# web/v10/exemple.txt, pont.js, Porte.tsx ; docs/exemple.md) ──
EXS1="l'entreprise d'essai reçoit le jeu entier, ses factures émises par le serveur au millime de la v10, une seule fois"
EXS2="jamais dans une vraie entreprise, ni dans une entreprise d'essai qui a ses propres pièces, ni chez un autre ; un refus n'écrit rien"
EXW="Skander, sur un compte neuf : l'exemple se remplit, la découverte va au bout, puis sa vraie entreprise et sa première facture, guidée jusqu'au brouillon"
POE2="l'entreprise d'essai déjà remplie ne se remplit pas deux fois"
POE3="encore vide, le serveur la remplit derrière une fenêtre d'attente, puis la page se rouvre sur la visite demandée ; un conflit se redemande une fois"
POE4="un refus se lit en entier, la fenêtre d'attente se ferme, et rien ne se rouvre"
POE5="quitter l'exemple sans vraie entreprise : son nom d'abord ; la visite part avec l'entreprise créée, jamais avant"
VEL="une visite que « Guide-moi » propose en ligne n'attend jamais un élément que la version en ligne ne montre pas"
VELT="la découverte proposée en ligne ne décrit pas l'application de bureau"
EXV=serveur/v10/exemple.ts
prouver "l'exemple versé dans une vraie entreprise" $EXV \
  "  if (!e?.essai) throw new Refus('exemple.vraie_entreprise');
" "" \
  "$EXS2"
prouver "l'exemple mêlé aux pièces d'une entreprise d'essai déjà essayée" $EXV \
  "  if (objets.some((o) => PIECES.includes(o.collection))) throw new Refus('exemple.essai_deja_utilisee');
" "" \
  "$EXS2"
prouver "l'exemple versé une seconde fois" $EXV \
  "  if (objets.some((o) => o.collection === '_racine' && o.cle === 'demo' && o.contenu === true)) return { deja: true, pieces: 0 };
" "" \
  "$EXS1"
prouver "les factures de l'exemple écrites au dossier sans être émises par le serveur" $EXV \
  "if (champ === 'documents' && (o.type === 'facture' || o.type === 'avoir') && o.status !== 'brouillon') { legales.push(o); continue; }" "if (false) { legales.push(o); continue; }" \
  "$EXS1"
prouver "le timbre des années de l'exemple d'avant la règle commune oublié" $EXV \
  "    await tx.query('select socle.poser_regle_entreprise(\$1, \$2, \$3, \$4, \$5, \$6)', [entreprise, 'timbre.facture', JSON.stringify(timbre), premier, veille, rendre(t('exemple.motif_timbre'), 'fr')]);
" "" \
  "$EXS1"
prouver "les règlements des factures de l'exemple perdus" $EXV \
  "    if (paiements.length) reglements.push(" "    if (false) reglements.push(" \
  "$EXS1"
prouver "une visite laissée en attente par une entreprise d'essai qui n'a pas pu se créer" $PONT \
  "        const id = essai ? essai.id : (await appelCompte('POST', '/entreprises-essai')).id;
        visiteApres(visite || 'exemple');" "        visiteApres(visite || 'exemple');
        const id = essai ? essai.id : (await appelCompte('POST', '/entreprises-essai')).id;" \
  "sans entreprise d'essai encore, elle se crée puis s'ouvre ; une création refusée ne laisse aucune visite en attente"
prouver "l'exemple déjà rempli qu'on redemande au serveur" $PONT \
  "      if ((/** @type {any} */ (window).__data || {}).demo === true) return { pret: true };
" "" \
  "$POE2"
prouver "un conflit avec l'enregistrement de départ de la page qui fait échouer l'exemple" $PONT \
  "            if (++conflits > 2 || x.statut !== 409) throw e;" "            throw e;" \
  "$POE3"
prouver "la fenêtre d'attente de l'exemple qui reste ouverte après un refus" $PONT \
  "        if (typeof fin === 'function') fin();
" "" \
  "$POE4"
prouver "une visite laissée en attente par la fenêtre du nom fermée sans créer" $PONT \
  "      if (!vraie) return { aCreer: true };
      if (o && typeof o.visite === 'string' && o.visite) visiteApres(o.visite);" "      if (o && typeof o.visite === 'string' && o.visite) visiteApres(o.visite);
      if (!vraie) return { aCreer: true };" \
  "$POE5"
prouver "l'entreprise créée en quittant l'exemple, ouverte sans sa visite" $PONT \
  "      if (o && typeof o.visite === 'string' && o.visite) visiteApres(o.visite);
      assistantApres(r.id);" "      assistantApres(r.id);" \
  "$POE5"
prouver "la visite demandée oubliée au changement de page" $PONT \
  "    try { sessionStorage.setItem(VISITE_APRES, id); } catch { /* sans stockage : l'exemple s'ouvre, sans sa visite */ }" "    void id;" \
  "$POE3"
prouver "« Guide-moi » qui propose en ligne de revenir à une sauvegarde" $PONT \
  "  const VISITES_SANS_OBJET = ['sauvegarde', 'restaurer'," "  const VISITES_SANS_OBJET = ['sauvegarde'," \
  "$VEL"
prouver "les puces des Paramètres qui mènent à un panneau absent" $PONT \
  "PANNEAUX_ABSENTS.flatMap((id) => [\`#\${id}\`, \`[data-somm=\"\${id}\"]\`, \`[data-go=\"\${id}\"]\`])" "PANNEAUX_ABSENTS.flatMap((id) => [\`#\${id}\`])" \
  "$VR"
prouver "« Commencer la découverte » qui ouvre une entreprise d'essai vide" web/src/ecrans/Porte.tsx \
  "    try { sessionStorage.setItem('skanfact.visite', 'decouvrir'); } catch { /* sans stockage : l'entreprise d'essai s'ouvre, sans la découverte */ }
" "" \
  "$EXW"
prouver "l'exemple chargé à l'écran au lieu d'être versé par le serveur" web/public/v10/app.js \
  "  async function loadDemo(visite) {
    if (bridge.exemple) {" "  async function loadDemo(visite) {
    if (false) {" \
  "$EXW"
prouver "l'exemple qui se prépare sans le dire" web/public/v10/app.js \
  "attendre: () => (fin = attenteExemple())" "attendre: () => null" \
  "$EXW"
prouver "la visite demandée jamais lancée une fois la page chargée" web/public/v10/app.js \
  "      else if (demandee) { const v = visiteParId(demandee); if (v) lancerVisite(v); }" "      else if (demandee) { void demandee; }" \
  "$EXW"
prouver "« Passer à ma vraie entreprise » qui oublie les premiers pas" web/public/v10/app.js \
  "      if (await demoSortie('premiers-pas')) lancerVisite(visiteParId('premiers-pas'));" "      if (await demoSortie()) lancerVisite(visiteParId('premiers-pas'));" \
  "$EXW"
prouver "l'entreprise créée depuis l'exemple sans la visite demandée" web/public/v10/app.js \
  "const x = await bridge.addDossier({ name: v, visite: typeof visite === 'string' ? visite : '' });" "const x = await bridge.addDossier({ name: v });" \
  "$EXW"
prouver "« Quitter l'exemple » qui fait comme sur l'ordinateur" web/public/v10/app.js \
  "    if (bridge.quitterExemple) {" "    if (false) {" \
  "$EXW"
prouver "« Me guider » qui propose en ligne les visites sans objet" web/public/v10/app.js \
  "  }).filter(v => !(bridge.visitesAbsentes || []).includes(v.id)));" "  }));" \
  "$EXW"
prouver "« Guide-moi » d'une nouvelle facture sans « Faire une facture »" web/public/v10/visites.js \
  "      surLaPage: cle => cle !== 'doc' || /^#\\/doc\\/new\\/facture/.test(hash())," "      surLaPage: () => false," \
  "$EXW"
prouver "l'étape des pièces jointes du devis qui attend un panneau absent" web/public/v10/visites.js \
  "        { cible: '#p-pj', cote: 'dessus', titre: 'Les pièces jointes', facultatif: true," "        { cible: '#p-pj', cote: 'dessus', titre: 'Les pièces jointes'," \
  "$VEL"
prouver "la découverte qui attend le panneau des mises à jour" web/public/v10/visites.js \
  "        { page: '#/parametres', cible: '#app-version', cote: 'droite', titre: 'Les mises à jour'," "        { page: '#/parametres', cible: '#p-maj', cote: 'droite', titre: 'Les mises à jour'," \
  "$VEL"
prouver "la découverte qui attend la copie vers une clé" web/public/v10/visites.js \
  "cible: '#p-appareils', cote: 'dessous', titre: 'Tes données à l\\'abri'," "cible: '#p-externe', cote: 'dessous', titre: 'Tes données à l\\'abri'," \
  "$VEL"
prouver "la découverte qui attend la clôture reçue en fichier" web/public/v10/visites.js \
  "        { page: '#/parametres', avant: onglet('#set-tabs', 'compte'), cible: '#p-appareils'" "        { page: '#/compta', avant: onglet('#c-tabs', 'clotures'), cible: '#p-cloture-cabinet', cote: 'dessus', titre: 'Sa clôture', texte: 'x' },
        { page: '#/parametres', avant: onglet('#set-tabs', 'compte'), cible: '#p-appareils'" \
  "$VEL"
prouver "la fin de la découverte qui parle de licence" web/public/v10/visites.js \
  "abonnement réglé ou pas, tu gardes la lecture, l\\'impression et l\\'export." "licence ou pas, tu gardes la lecture, l\\'impression, l\\'export et l\\'envoi à ton comptable." \
  "$VELT"
prouver "la découverte qui décrit le paquet du comptable" web/public/v10/visites.js \
  "Rien à lui envoyer : tu lui confies ton entreprise une fois" "Chaque mois, un paquet : tu lui confies ton entreprise une fois" \
  "$VELT"
prouver "l'exemple qui « rend tes vraies données » en ligne" web/public/v10/visites.js \
  "<b>« Quitter l\\'exemple »</b> ouvre ta vraie entreprise : l\\'exemple vit à part" "<b>« Quitter l\\'exemple »</b> te rend tes vraies données — elles ont été mises de côté : l\\'exemple vit à part" \
  "$VELT"
prouver "la réponse au comptable qui part « dans le paquet du mois »" web/public/v10/visites.js \
  "Tu réponds en une phrase ; il la lit dès que tu l\\'enregistres." "Tu réponds en une phrase ; ta réponse repart dans le paquet du mois." \
  "$VELT"

# ── Le lot facture (05/10/2026 ; le parcours d'un commerçant, docs/facture-details.md ; web/v10/facture-details.txt,
# serveur/v10/identite.ts, 0071, serveur/v10/dossier.ts) ──
IDS1='le nom et le matricule écrits dans la fiche deviennent ceux de l'\''entreprise, sous leur forme lisible ; la trace le dit, et la facture suivante les fige'
IDS2='un matricule mal formé ne se porte pas ; celui d'\''une autre entreprise se refuse en le disant, et rien n'\''est écrit'
IDS3='l'\''entreprise d'\''essai garde son nom et son matricule, quoi qu'\''écrive sa fiche'
DOSR='une facture émise avec la retenue en texte reste la même une fois relue en nombre : ses règlements s'\''enregistrent ; un autre taux, non'
MAT1='l'\''écran et le serveur disent la même chose de chaque matricule écrit, et l'\''écrivent pareil sous sa forme lisible'
MAT2='la fiche société nomme un matricule mal formé comme un matricule absent, et laisse en paix un matricule juste'
FDW='Samia, sans matricule ni RIB : la pièce n'\''imprime rien de vide, la fiche se complète avant d'\''émettre, et le reste suit'
prouver 'la fiche qui ne porte pas son identité à l'\''entreprise' serveur/v10/dossier.ts \
  '  await suivreIdentite(tx, entreprise, lus);
' '' \
  "$IDS1"
prouver 'le matricule porté tel qu'\''il est écrit' commun/matricule.ts \
  '? `${c.slice(0, 8)}/${c[8]}/${c[9]}/${c.slice(10)}` : undefined' '? c : undefined' \
  "$IDS1"
prouver 'un matricule mal formé qui efface celui de l'\''entreprise' commun/matricule.ts \
  '  if (!c) return null;' '  if (!c || !/^[0-9]{7}[A-Z]{3}[0-9]{3}$/.test(c)) return null;' \
  "$IDS2"
prouver 'le matricule d'\''une autre entreprise porté sans refus' base/migrations/0071_identite_suit_la_fiche.sql \
  '  if p_matricule is not null and exists (select 1 from socle.entreprise x where x.active and x.matricule_fiscal = p_matricule and x.id <> p_entreprise) then' '  if false then' \
  "$IDS2"
prouver 'l'\''entreprise d'\''essai renommée par la fiche de son exemple' base/migrations/0071_identite_suit_la_fiche.sql \
  'if not found or e.essai or e.tenue_par is not null then return null; end if;' 'if not found or e.tenue_par is not null then return null; end if;' \
  "$IDS3"
prouver 'la retenue relue en nombre, prise pour un changement de la pièce scellée' serveur/v10/dossier.ts \
  'const scellee = (champ: string, v: unknown) => (champ === '\''withholdingRate'\'' ? tauxRelu(v) : canonique(v));' 'const scellee = (_champ: string, v: unknown) => canonique(v);' \
  "$DOSR"
prouver 'tous les taux de retenue d'\''une pièce scellée tenus pour égaux' serveur/v10/dossier.ts \
  'return Number.isFinite(n) && n !== 0 ? String(n) : '\''0'\'';' 'return '\''0'\'';' \
  "$DOSR"
prouver 'l'\''écran qui laisse passer un matricule que le serveur ne porte pas' web/public/v10/core.js \
  '  const MF_FORME = /^[0-9]{7}[A-HJ-NP-TV-Z][A-Z]{2}[0-9]{3}$/;' '  const MF_FORME = /^[0-9]{7}[A-Z]{1,3}[0-9]{0,3}$/;' \
  "$MAT1"
prouver 'un matricule mal formé que la fiche ne nomme pas' web/public/v10/core.js \
  '    else if (!matriculeBienForme(c.matricule)) out.push('\''un matricule fiscal valide' '    else if (false) out.push('\''un matricule fiscal valide' \
  "$MAT2"
prouver '« MF » imprimé sans matricule' web/public/v10/core.js \
  'String(company.matricule || '\'''\'').trim() ? `${L.mf} ${escapeHtml(matriculeLisible(company.matricule))}` : '\'''\''' '`${L.mf} ${escapeHtml(matriculeLisible(company.matricule))}`' \
  "$FDW"
prouver 'le tampon posé sur l'\''objet de la pièce' web/public/v10/core.js \
  '.stamp { position: absolute; left: 50%; top: 150mm; transform: translate(-50%, -50%) rotate(-24deg);' '.stamp { position: absolute; top: 62mm; right: 24mm; transform: rotate(-12deg);' \
  "$FDW"
prouver 'le tampon opaque, qui cache ce qu'\''il couvre' web/public/v10/core.js \
  'opacity: .16; mix-blend-mode: multiply;' 'opacity: .45;' \
  "$FDW"
prouver 'l'\''avertissement d'\''émission qui ne nomme pas ce qui manque' web/public/v10/app.js \
  'Ton matricule fiscal manque : il est obligatoire sur une facture en Tunisie' 'Ta fiche société est incomplète (raison sociale ou matricule fiscal) : il est obligatoire sur une facture en Tunisie' \
  "$FDW"
prouver 'la fenêtre d'\''émission sans le geste qui complète la fiche' web/public/v10/app.js \
  'id="em-fiche">Compléter ma fiche…</button>' 'id="em-fiche" hidden>Compléter ma fiche…</button>' \
  "$FDW"
prouver 'la fenêtre d'\''émission qui ne se relit pas après la fiche' web/public/v10/app.js \
  '              $('\''#em-avert'\'', root).innerHTML = avertir(l);
' '' \
  "$FDW"
prouver 'un matricule mal formé qui part au serveur' web/public/v10/app.js \
  'if (manqueMf && !C.matriculeBienForme(v.matricule)) return refuser(' 'if (false) return refuser(' \
  "$FDW"
# Depuis E5, deux gestes reprennent le matricule refusé : le point de contact (seul refusé, il remet celui du serveur) et
# la fenêtre (un refus qui lui arrive quand même remet ce qu'elle avait). Le défaut, c'est perdre les deux.
prouver 'la fiche qui garde le matricule que le serveur a refusé' 'web/public/plateforme/pont.js|||web/public/v10/app.js' \
  '    fiche.matricule = garde;
|||            Object.assign(co, avant);
' '|||' \
  "$FDW"
prouver 'la retenue émise en texte, telle que la liste l'\''écrit' web/public/v10/app.js \
  '      doc.withholdingRate = Number(doc.withholdingRate) || 0;
' '' \
  "$FDW"
prouver '« une retenue subie de août »' web/public/v10/app.js \
  'c'\''est une retenue subie ${/^[aeiou]/i.test(' 'c'\''est une retenue subie ${/^$/i.test(' \
  "$FDW"
prouver 'le menu qui promet un PDF joint au message' web/public/v10/app.js \
  'hint: !bridge.ajouterLien ? '\''Le PDF est joint au message'\'' :' 'hint: true ? '\''Le PDF est joint au message'\'' :' \
  "$FDW"
prouver '« Ouvrir » qui propose de modifier une pièce émise' web/public/v10/app.js \
  'hint: !emiseIci ? '\''Voir la pièce et la modifier'\'' :' 'hint: true ? '\''Voir la pièce et la modifier'\'' :' \
  "$FDW"
prouver 'l'\''espace du client sans ce qui a déjà été payé' web/public/espace/espace.js \
  '${recu(p) ? `<span class="recu"> · ${recu(p)}</span>` : '\'''\''}' '' \
  "$FDW"
prouver 'le refus du serveur à l'\''émission dans un bandeau de trois secondes' web/public/v10/app.js \
  '          infoDialog(doc.type === '\''avoir'\'' ? '\''L\'\''avoir n\'\''est pas émis'\''' '          toast(motif, true) || void (doc.type === '\''avoir'\'' ? '\''L\'\''avoir n\'\''est pas émis'\''' \
  "$FDW"

# ── Vu sur le serveur d'essai après le lot facture (05/10/2026 ; docs/facture-details.md, E1 à E3) ──
# E1 : une réponse qui ne vient pas du serveur (un relais qui coupe une demande longue, le frontal), aux trois portes ;
# E2 : le matricule imprimé tel qu'il a été tapé, sur chaque pièce ; E3 : la lettre-clé I, O ou U. (Les deux preuves
# qui « prouvaient » en cassant la syntaxe d'un écran sont réécrites à leur place ; tests/verif-preuves.sh le contrôle.)
CPE1='une réponse coupée en route : la page redemande, le serveur a fini, et elle s'\''ouvre sur la visite ; jamais le texte du relais'
CPE2='coupée à chaque fois : une phrase qui dit quoi faire, la fenêtre d'\''attente fermée, rien ne se rouvre'
CPE3='une réponse qui ne vient pas du serveur ne s'\''affiche jamais telle quelle, par l'\''entreprise comme par le compte'
CPE4='au Cabinet : « le serveur n'\''a pas répondu », jamais le texte du relais ; un vrai refus garde sa phrase'
CPE5='aux écrans d'\''entrée : un serveur qui ne répond pas (ErreurReseau), jamais l'\''erreur du lecteur ; un vrai refus rendu tel quel'
MAT3='chaque pièce imprimée porte les matricules sous leur forme lisible, en tête comme au pied ; une carte d'\''identité, telle quelle'
prouver 'la réponse d'\''un relais lue comme du JSON par l'\''entreprise (l'\''erreur du lecteur à l'\''écran)' web/public/plateforme/pont.js \
  '    try { if (!texte) throw new SyntaxError('\''vide'\''); return JSON.parse(texte); } catch {' '    try { return JSON.parse(texte || '\''{}'\''); } catch (e) { throw e;' \
  "$CPE3"
prouver 'une réponse vide d'\''un relais (502, 503, 504) prise pour celle du serveur, côté entreprise' web/public/plateforme/pont.js \
  'if (!texte && ![502, 503, 504].includes(r.status)) return {};' 'if (!texte) return {};' \
  "$CPE3"
prouver 'l'\''exemple abandonné à la première coupure' web/public/plateforme/pont.js \
  '            if ((x.coupe || x.horsLigne) && ++coupes <= 4)' '            if (false)' \
  "$CPE1"
prouver 'une coupure répétée qui dit « réessaie » sans dire quoi faire de l'\''exemple' web/public/plateforme/pont.js \
  '            if (x.coupe) throw Object.assign(new Error('\''La connexion au serveur a coupé avant la fin' '            if (false) throw Object.assign(new Error('\''La connexion au serveur a coupé avant la fin' \
  "$CPE2"
prouver 'le Cabinet qui lit la réponse d'\''un relais comme du JSON' web/public/plateforme/pont-cabinet.js \
  '    const lu = lire(r, await r.text());' '    const texte = await r.text(); const lu = texte ? JSON.parse(texte) : {};' \
  "$CPE4"
prouver 'une réponse vide d'\''un relais prise pour celle du serveur, au Cabinet' web/public/plateforme/pont-cabinet.js \
  'if (!texte && ![502, 503, 504].includes(r.status)) return {};' 'if (!texte) return {};' \
  "$CPE4"
prouver 'les écrans d'\''entrée qui lisent la réponse d'\''un relais comme du JSON' web/src/api.ts \
  '  try { lu = (texte ? JSON.parse(texte) : {}) as Reponse<T>['\''corps'\'']; } catch { throw new ErreurReseau(); }' '  lu = (texte ? JSON.parse(texte) : {}) as Reponse<T>['\''corps'\''];' \
  "$CPE5"
prouver 'l'\''en-tête de la pièce qui imprime le matricule tel que tapé' web/public/v10/core.js \
  '`${L.mf} ${escapeHtml(matriculeLisible(company.matricule))}`' '`${L.mf} ${escapeHtml(company.matricule)}`' \
  "$MAT3"
prouver 'le pied de la pièce qui imprime le matricule tel que tapé' web/public/v10/core.js \
  ''\''Matricule fiscal '\'') + matriculeLisible(company.matricule)' ''\''Matricule fiscal '\'') + company.matricule' \
  "$MAT3"
prouver 'la pièce qui imprime le matricule du client tel que tapé' web/public/v10/core.js \
  'L.mfCin + '\'' '\'' + escapeHtml(matriculeLisible(cl.matricule))' 'L.mfCin + '\'' '\'' + escapeHtml(cl.matricule)' \
  "$MAT3"
prouver 'le ticket de caisse qui imprime le matricule tel que tapé' web/public/v10/core.js \
  ''\''<br>MF '\'' + escapeHtml(matriculeLisible(co.matricule))' ''\''<br>MF '\'' + escapeHtml(co.matricule)' \
  "$MAT3"
prouver 'l'\''en-tête du bulletin de paie qui imprime le matricule tel que tapé' web/public/v10/core.js \
  '      <div class="co-name">${escapeHtml(company.name || '\'''\'')}</div>
      <div class="co-sub">${escapeHtml(company.address || '\'''\'').replace(/\n/g, '\''<br>'\'')}
        ${company.matricule ? `<br>MF : ${escapeHtml(matriculeLisible(company.matricule))}`' '      <div class="co-name">${escapeHtml(company.name || '\'''\'')}</div>
      <div class="co-sub">${escapeHtml(company.address || '\'''\'').replace(/\n/g, '\''<br>'\'')}
        ${company.matricule ? `<br>MF : ${escapeHtml(company.matricule)}`' \
  "$MAT3"
prouver 'le pied du bulletin de paie qui imprime le matricule tel que tapé' web/public/v10/core.js \
  ''\'' — MF '\'' + escapeHtml(matriculeLisible(company.matricule)) : '\'''\''} · Bulletin de' ''\'' — MF '\'' + escapeHtml(company.matricule) : '\'''\''} · Bulletin de' \
  "$MAT3"
prouver 'l'\''en-tête des documents du personnel qui imprime le matricule tel que tapé' web/public/v10/core.js \
  '    <div><div class="co-name">${escapeHtml(company.name || '\'''\'')}</div>
      <div class="co-sub">${escapeHtml(company.address || '\'''\'').replace(/\n/g, '\''<br>'\'')}
        ${company.matricule ? `<br>MF : ${escapeHtml(matriculeLisible(company.matricule))}`' '    <div><div class="co-name">${escapeHtml(company.name || '\'''\'')}</div>
      <div class="co-sub">${escapeHtml(company.address || '\'''\'').replace(/\n/g, '\''<br>'\'')}
        ${company.matricule ? `<br>MF : ${escapeHtml(company.matricule)}`' \
  "$MAT3"
prouver 'l'\''attestation de travail qui écrit le matricule tel que tapé' web/public/v10/core.js \
  ', matricule fiscal ${escapeHtml(matriculeLisible(company.matricule))}` : '\'''\''}, atteste' ', matricule fiscal ${escapeHtml(company.matricule)}` : '\'''\''}, atteste' \
  "$MAT3"
prouver 'le certificat de travail qui écrit le matricule tel que tapé' web/public/v10/core.js \
  ', matricule fiscal ${escapeHtml(matriculeLisible(company.matricule))}` : '\'''\''}, certifie' ', matricule fiscal ${escapeHtml(company.matricule)}` : '\'''\''}, certifie' \
  "$MAT3"
prouver 'le solde de tout compte qui écrit le matricule tel que tapé' web/public/v10/core.js \
  ', matricule fiscal ${escapeHtml(matriculeLisible(company.matricule))}` : '\'''\''}, d'\''une part' ', matricule fiscal ${escapeHtml(company.matricule)}` : '\'''\''}, d'\''une part' \
  "$MAT3"
prouver 'le pied des documents du personnel qui imprime le matricule tel que tapé' web/public/v10/core.js \
  ''\'' — MF '\'' + escapeHtml(matriculeLisible(company.matricule)) : '\'''\''}</div>' ''\'' — MF '\'' + escapeHtml(company.matricule) : '\'''\''}</div>' \
  "$MAT3"
prouver 'l'\''en-tête du relevé de compte qui imprime le matricule tel que tapé' web/public/v10/core.js \
  '${W.mf} : ${escapeHtml(matriculeLisible(company.matricule))}` : '\'''\''}</div></div>' '${W.mf} : ${escapeHtml(company.matricule)}` : '\'''\''}</div></div>' \
  "$MAT3"
prouver 'le relevé de compte qui imprime le matricule du client tel que tapé' web/public/v10/core.js \
  '${W.mf} : ${escapeHtml(matriculeLisible(c.matricule))}' '${W.mf} : ${escapeHtml(c.matricule)}' \
  "$MAT3"
prouver 'le pied du relevé de compte qui imprime le matricule tel que tapé' web/public/v10/core.js \
  '` — ${W.mf} ` + escapeHtml(matriculeLisible(company.matricule))' '` — ${W.mf} ` + escapeHtml(company.matricule)' \
  "$MAT3"
prouver 'la page de garde du paquet qui imprime le matricule tel que tapé' web/public/v10/core.js \
  'esc(matriculeLisible(company.matricule))' 'esc(company.matricule)' \
  "$MAT3"
prouver 'la fiche complétée qui garde le matricule tel que tapé' web/public/v10/app.js \
  'if (manqueMf) co.matricule = C.matriculeLisible(v.matricule);' 'if (manqueMf) co.matricule = v.matricule;' \
  "$FDW"
prouver 'la lettre-clé I, O ou U acceptée à l'\''écran' web/public/v10/core.js \
  'const MF_FORME = /^[0-9]{7}[A-HJ-NP-TV-Z]' 'const MF_FORME = /^[0-9]{7}[A-Z]' \
  "$MAT1"
prouver 'la lettre-clé I, O ou U portée à l'\''entreprise par le serveur' commun/matricule.ts \
  '/^[0-9]{7}[A-HJ-NP-TV-Z][A-Z]{2}[0-9]{3}$/.test(c)' '/^[0-9]{7}[A-Z][A-Z]{2}[0-9]{3}$/.test(c)' \
  "$MAT1"
prouver 'la fiche qui ne dit pas que la lettre-clé n'\''est jamais I, O ni U' web/public/v10/core.js \
  'sept chiffres, une lettre autre que I, O ou U, puis code TVA' 'sept chiffres, une lettre, puis code TVA' \
  "$MAT2"

# ── E4 : la même règle du matricule à toutes ses entrées (05/10/2026 ; docs/facture-details.md, E4) ──
# La porte, le dossier tenu d'un cabinet, la reprise d'un portefeuille et la liste collée : la forme lisible gardée,
# la lettre-clé jamais I, O ni U, un refus qui dit pourquoi sur son champ, un matricule déjà pris refusé en le disant.
POR1='écrit comme on le recopie, il se garde sous sa forme lisible ; mal formé, il se refuse sur son champ en disant pourquoi, et rien n'\''est créé'
POR2='déjà celui d'\''une autre entreprise, sous n'\''importe quelle écriture : refusé en le disant, et rien n'\''est créé'
NT1='le nom et le matricule d'\''un dossier tenu : un associé les corrige, tracés ; un collaborateur, non ; ceux d'\''un client sur SkanFact, jamais ; un matricule déjà pris, refusé en le disant'
RP2='ce qui ne se reprendrait pas tel quel est nommé et rien ne se crée ; un champ de plus (la clé privée) refusé ; un collaborateur refusé'
WL1E4='une ligne fausse arrête tout ; la liste corrigée ajoute chaque client, un doublon est ignoré et nommé'
PARC='du compte à la facture émise par le serveur, retrouvée après rechargement, puis le retour d'\''un autre appareil'
prouver 'la porte qui garde le matricule tel qu'\''il est écrit' serveur/routes/socle.ts \
  '[corps.raisonSociale, matricule])).rows[0].id;' '[corps.raisonSociale, corps.matriculeFiscal ?? null])).rows[0].id;' \
  "$POR1"
prouver 'la porte qui laisse passer un matricule mal formé' serveur/routes/socle.ts \
  '      if (matricule === undefined) return refusDuMatricule(corps.matriculeFiscal);
' '' \
  "$POR1"
prouver 'le refus du matricule sans son champ' serveur/matricule.ts \
  ', champ } };' ' } };' \
  "$POR1"
prouver 'la lettre-clé I, O ou U acceptée à la porte' commun/matricule.ts \
  '/^[0-9]{7}[A-HJ-NP-TV-Z][A-Z]{2}[0-9]{3}$/.test(c)' '/^[0-9]{7}[A-Z][A-Z]{2}[0-9]{3}$/.test(c)' \
  "$POR1"
prouver 'la porte qui répond « erreur du serveur » à un matricule déjà pris' base/migrations/0072_matricule_a_la_porte.sql \
  '  if p_matricule_fiscal is not null and exists (select 1 from socle.entreprise x where x.active and x.matricule_fiscal = p_matricule_fiscal) then' '  if false then' \
  "$POR2"
prouver 'le même matricule sans barres qui passe la porte une seconde fois' serveur/routes/socle.ts \
  'const matricule = matriculeCanonique(corps.matriculeFiscal);
      if (matricule === undefined) return refusDuMatricule(corps.matriculeFiscal);
      const id = (await tx.query('\''select socle.creer_entreprise(' 'const matricule = corps.matriculeFiscal?.trim().toUpperCase() || null;
      const id = (await tx.query('\''select socle.creer_entreprise(' \
  "$POR2"
prouver 'le dossier tenu qui garde le matricule tel qu'\''il est écrit' serveur/cabinet/routes.ts \
  '[params.cabinet, corps.raisonSociale, matricule])).rows[0].id as string;' '[params.cabinet, corps.raisonSociale, corps.matriculeFiscal ?? null])).rows[0].id as string;' \
  "$NT1"
prouver 'la lettre-clé I, O ou U acceptée au dossier tenu' commun/matricule.ts \
  '/^[0-9]{7}[A-HJ-NP-TV-Z][A-Z]{2}[0-9]{3}$/.test(c)' '/^[0-9]{7}[A-Z][A-Z]{2}[0-9]{3}$/.test(c)' \
  "$NT1"
prouver 'deux écritures du même matricule qui passent la reprise' serveur/reprise/cabinet-v10.ts \
  '    if (matricule) matricules.add(matricule);' '    if (matricule) matricules.add(d.matricule);' \
  "$RP2"
prouver 'la lettre-clé I, O ou U acceptée à la reprise' commun/matricule.ts \
  '/^[0-9]{7}[A-HJ-NP-TV-Z][A-Z]{2}[0-9]{3}$/.test(c)' '/^[0-9]{7}[A-Z][A-Z]{2}[0-9]{3}$/.test(c)' \
  "$RP2"
prouver 'la liste collée qui laisse passer la lettre-clé O' web/public/plateforme/pont-cabinet.js \
  'return /^[0-9]{7}[A-HJ-NP-TV-Z][A-Z]{2}[0-9]{3}$/.test(c)' 'return /^[0-9]{7}[A-Z][A-Z]{2}[0-9]{3}$/.test(c)' \
  "$WL1E4"
prouver 'la porte sans la forme attendue du matricule' web/src/ecrans/Porte.tsx \
  ' placeholder="1234567A/A/M/000"' '' \
  "$PARC"

# ── E5 : le refus d'un matricule montre sa case, et n'en bloque pas d'autres (06/10/2026 ; docs/facture-details.md, E5) ──
# Le refus nomme son champ ; la porte et le Cabinet marquent la case ; la case du Cabinet tient la règle du serveur ; une
# liste collée nomme la ligne refusée ; dans la fiche société, le matricule est seul refusé et le reste s'enregistre.
IDT5='un matricule mal formé ne se porte pas ; celui d'\''une autre entreprise se refuse en le disant, et rien n'\''est écrit'
WLE5='un matricule refusé se dit sur sa case ; dans une liste, la ligne refusée est nommée avec ce qui est entré (E5)'
NDT5='le dossier tenu se renomme et reçoit son matricule ; celui d'\''un client sur SkanFact reste le sien'
FDE5='la fiche société : un matricule déjà pris est refusé seul, le reste s'\''enregistre, et rien ne reste bloqué (E5)'
FD15='Samia, sans matricule ni RIB : la pièce n'\''imprime rien de vide, la fiche se complète avant d'\''émettre, et le reste suit'
for t in "$POR2" "$NT1" "$IDT5" "$PARC"; do
  prouver "le refus d'un matricule déjà pris, sans son champ (${t:0:40}…)" serveur/app.ts \
    'bouton: err.bouton ?? null, ...(champ ? { champ } : {}) });' 'bouton: err.bouton ?? null });' \
    "$t"
done
prouver 'le matricule déjà pris à la porte et sur la fiche, sans son champ' serveur/erreurs.ts \
  "  'base.entreprise.matricule_pris': 'matriculeFiscal',
" '' \
  "$POR2"
prouver 'le matricule déjà pris d'\''un dossier tenu, sans son champ' serveur/erreurs.ts \
  "  'base.cabinet.matricule_pris': 'matriculeFiscal',
" '' \
  "$NT1"
prouver 'le matricule déjà pris qui dit « Rien n'\''a été enregistré » quand le reste l'\''est' textes/base.ts \
  'relis-le sur ta carte d\'\''identification fiscale'\'' },' 'relis-le sur ta carte d\'\''identification fiscale. Rien n\'\''a été enregistré'\'' },' \
  "$POR2"
prouver 'la case du Cabinet qui laisse passer la lettre-clé O' web/public/v10/cabinet/app.js \
  'const matriculeFiscalLisible = m => !m || /^[0-9]{7}[A-HJ-NP-TV-Z]' 'const matriculeFiscalLisible = m => !m || /^[0-9]{7}[A-Z]' \
  "$WLE5"
for t in "$WLE5" "$NDT5"; do
  prouver "la case du Cabinet qui dit l'ancienne règle (${t:0:40}…)" web/public/v10/cabinet/app.js \
    's\'\''écrit comme sur la carte d\'\''identification fiscale : sept chiffres, une lettre autre que I, O ou U, puis code TVA, catégorie et établissement (1234567A/A/M/000). Laisse' 's\'\''écrit 1234567A/B/C/000 : sept chiffres, trois lettres, trois chiffres. Laisse' \
    "$t"
done
prouver 'le matricule déjà pris d'\''un nouveau dossier, dit en bas de l'\''écran seulement' web/public/v10/cabinet/app.js \
  'matricule mal écrit (il ne se disait qu'\''en bas de l'\''écran).
            if (e && e.champ === '\''matriculeFiscal'\'') return refus($('\''#f-mat'\'', layer), plainError(e));' 'matricule mal écrit (il ne se disait qu'\''en bas de l'\''écran).' \
  "$WLE5"
prouver 'le matricule déjà pris dans la fiche d'\''un dossier tenu, dit en bas de l'\''écran seulement' web/public/v10/cabinet/app.js \
  'refusé sur sa case.
            if (e && e.champ === '\''matriculeFiscal'\'') return refus($('\''#f-mat'\'', layer), plainError(e));' 'refusé sur sa case.' \
  "$NDT5"
for t in "$WLE5" "$NDT5"; do
  prouver "le refus du serveur qui perd son champ au Cabinet (${t:0:40}…)" web/public/plateforme/pont-cabinet.js \
    '{ champ: typeof lu.champ === '\''string'\'' ? lu.champ : null }' '{ champ: null }' \
    "$t"
done
prouver 'la liste collée qui s'\''arrête sans nommer la ligne ni dire ce qui est entré' web/public/plateforme/pont-cabinet.js \
  '« ${d.name} » : ${raison} ${entres}' '${x.message}' \
  "$WLE5"
prouver 'la fiche dont le matricule refusé emporte tout l'\''envoi' web/public/plateforme/pont.js \
  '        if (!matriculeRepris && garderLeMatricule(e, lot, data)) return envoyer(data, true);
' '' \
  "$FDE5"
prouver 'le refus de l'\''envoi qui perd son champ' web/public/plateforme/pont.js \
  "(e).champ = typeof lu.champ === 'string' ? lu.champ : null;" '(e).champ = null;' \
  "$FDE5"
prouver 'la fiche qui garde le matricule refusé' web/public/plateforme/pont.js \
  '    fiche.matricule = garde;
' '' \
  "$FDE5"
prouver 'le matricule refusé seul, sans un mot à l'\''écran' web/public/v10/app.js \
  'if (r && r.matriculeRefuse) matriculeRefuse(r.matriculeRefuse); ' '' \
  "$FDE5"
prouver 'la case des Paramètres qui montre le matricule refusé' web/public/v10/app.js \
  '    if (champ) champ.value = x.garde;
' '' \
  "$FDE5"
prouver '« Corriger mon matricule » qui ne mène pas à la case' web/public/v10/app.js \
  "allerParametres('societe', 'p-identite:matricule'); };" "allerParametres('societe', 'p-identite'); };" \
  "$FDE5"
prouver '« Compléter ma fiche » qui se ferme sur un matricule refusé' web/public/v10/app.js \
  "            if (r && r.matriculeRefuse) { b.disabled = false; return refuser('matricule', r.matriculeRefuse.motif); }
" '' \
  "$FD15"

# ── Le lot téléphone (06/10/2026 ; le parcours d'un commerçant au téléphone, la caisse sur la tablette ; docs/telephone.md) ──
TL1='les listes au téléphone : une carte par ligne, chaque case sous le titre de sa colonne ; à l'\''ordinateur, un tableau'
TL2='une fenêtre longue garde ses boutons au bas de l'\''écran ; « Plus ▾ » s'\''ouvre au bas de l'\''écran, sur toute sa largeur'
TL3='une pièce au téléphone : l'\''étape suivante en tête, « WhatsApp » à côté d'\''« Email », chaque bulle avec son bouton ; le bandeau d'\''une pièce émise tient'
TL4='les lignes d'\''un achat et d'\''une photo relue au téléphone : la désignation, puis prix, TVA et total dans l'\''écran'
TL5='la première émission au téléphone : « Je facturais déjà » tient dans sa fenêtre ; « Ctrl K » ne se montre qu'\''à l'\''ordinateur ; « ta seule pièce »'
TL6='la caisse sur la tablette (1 180 × 820) et sur un écran de 1 024 × 768 : rien n'\''est tranché, le comptage tient'
ENV9='la facture part avec son lien, par e-mail puis par WhatsApp ; le devis aussi ; le relevé part sans rien de joint'
prouver "les listes du téléphone restées des tableaux trop larges" web/public/plateforme/telephone.js \
  "poser(table, 'data-cartes', 'oui');" "poser(table, 'data-cartes', '');" \
  "$TL1"
prouver "les cases d'une carte sans le titre de leur colonne" web/public/plateforme/telephone.js \
  "poser(td, 'data-label', nomme ? '' : titre);" "poser(td, 'data-label', '');" \
  "$TL1"
prouver "une liste redessinée qui perd ses cartes" web/public/plateforme/telephone.js \
  "prevu = requestAnimationFrame(passer); }).observe(" "prevu = 0; }).observe(" \
  "$TL1"
prouver "« Actions » qui sort de sa carte" web/public/plateforme/telephone.css \
  "inset-inline-end: 8px; width: auto; }" "inset-inline-end: 8px; }" \
  "$TL1"
prouver "« Enregistrer » au bout d'une fenêtre longue" web/public/plateforme/telephone.css \
  ".modal > .modal-actions:last-child { position: sticky; bottom: -18px;" ".modal > .modal-actions:last-child { bottom: -18px;" \
  "$TL2"
prouver "« Plus ▾ » accroché à son bouton, hors de l'écran" web/public/plateforme/telephone.css \
  ".more-list { position: fixed; inset: auto 8px" ".more-list { inset: auto 8px" \
  "$TL2"
prouver "l'étape suivante perdue au milieu de la barre" web/public/plateforme/telephone.css \
  "{ order: -1; flex-basis: 100%; }" "{ }" \
  "$TL3"
prouver "« WhatsApp » caché dans « Plus » au téléphone" web/public/v10/app.js \
  "\${avecPlus ? '<button class=\"btn tel-seul\" id=\"wa-tel\">WhatsApp</button>' : ''}" "" \
  "$TL3"
prouver "le « WhatsApp » du téléphone qui ne se montre pas" web/public/plateforme/telephone.css \
  "  .tel-seul { display: inline-flex; }" "" \
  "$TL3"
prouver "le « WhatsApp » du téléphone qui n'envoie rien" web/public/v10/app.js \
  "    if (\$('#wa-tel')) \$('#wa-tel').onclick = envoyerPar(sendByWhatsApp, 'Envoyer par WhatsApp');
" "" \
  "$TL3"
prouver "le « WhatsApp » du téléphone montré à l'ordinateur" web/public/plateforme/telephone.css \
  ".tel-seul { display: none; }" "" \
  "$TL3"
prouver "la bulle d'un filtre seule sur sa ligne" web/public/plateforme/telephone.css \
  "  .filters > :has(+ button.i) { flex-basis: calc(100% - 56px); }" "" \
  "$TL3"
prouver "la bulle d'un bouton caché qui reste" web/public/plateforme/telephone.css \
  ".colle-bouton:has(> .btn[hidden]) { display: none; }" "" \
  "$TL3"
prouver "« Facturer ce devis » séparé de sa bulle" web/public/v10/app.js \
  "<div class=\"colle-bouton\"><button class=\"btn btn-primary\" id=\"convert\">Facturer ce devis</button>\${info('ed.convert')}
           <div class=\"more\"><button class=\"btn\" id=\"bill-btn\" aria-label=\"Autres façons de facturer\">▾</button>
             <div class=\"more-list\" id=\"bill-list\" hidden>\${autresChemins}</div></div></div>\`" "<button class=\"btn btn-primary\" id=\"convert\">Facturer ce devis</button>\${info('ed.convert')}
           <div class=\"more\"><button class=\"btn\" id=\"bill-btn\" aria-label=\"Autres façons de facturer\">▾</button>
             <div class=\"more-list\" id=\"bill-list\" hidden>\${autresChemins}</div></div>\`" \
  "$TL3"
prouver "le bandeau d'une pièce émise sur la moitié du téléphone" web/public/plateforme/telephone.css \
  "  .lock-banner .tel-detail { display: none; }" "" \
  "$TL3"
prouver "les lignes d'un achat et d'une photo relue cachées à droite au téléphone" web/public/plateforme/telephone.css \
  "  @supports selector(:has(*)) {" "  @supports not selector(:has(*)) {" \
  "$TL4"
prouver "« Je facturais déjà » qui sort de sa fenêtre" web/public/plateforme/telephone.css \
  "  .modal .btn { white-space: normal; text-align: start; }" "" \
  "$TL5"
prouver "« Ctrl K » montré au doigt" web/public/plateforme/telephone.css \
  "  #nav-search-k { display: none; }" "" \
  "$TL5"
prouver "« les 1 dernières pièces sur 1 »" web/public/v10/app.js \
  "'ta seule pièce'" "'les 1 dernières pièces sur 1'" \
  "$TL5"
prouver "la pastille de la caisse tranchée à 1 180 points" web/public/plateforme/caisse.css \
  "  .ct-puce-qui, .ct-nom small { display: none; }" "  .ct-nom small { display: none; }" \
  "$TL6"
prouver "la pastille de la caisse sans forme courte" web/public/v10/app.js \
  "Ouverte<span class=\"ct-puce-qui\"> par \${h(ss.qui)} le \${h(heureCaisse(ss.ouverteLe))}</span> · fond" "Ouverte par \${h(ss.qui)} le \${h(heureCaisse(ss.ouverteLe))} · fond" \
  "$TL6"
prouver "« billets » tranché par la case du nombre" web/public/plateforme/caisse.css \
  "@container (max-width: 400px) { .ct-coupure-sorte { display: none; } }" "" \
  "$TL6"
prouver "le comptage de 1 024 × 768 sous « Fermer la caisse »" web/public/plateforme/caisse.css \
  "@media (min-width: 921px) and (max-height: 820px) {" "@media (min-width: 921px) and (max-height: 1px) {" \
  "$TL6"
prouver "« glisse-le » : un geste qu'un téléphone ne fait pas" web/public/v10/app.js \
  "« Exporter en PDF » l\\'enregistre ; joins-le ensuite au message." "« Exporter en PDF » l\\'enregistre ; glisse-le ensuite dans le message." \
  "$ENV9"

# ── Le devis par son lien (06/10/2026 ; docs/espace-client.md, E9) ──
DV1='le devis par son lien : un devis envoyé de CE client, à part des factures, jamais en brouillon ; il ne compte pas dans ce que le client doit'
DV2='une pièce réduite à ce qu'\''elle imprime s'\''imprime exactement comme la pièce entière'
DV3='la facture part avec son lien, par e-mail puis par WhatsApp ; le devis aussi ; le relevé part sans rien de joint'
prouver "l'espace qui montre le devis d'un autre client" base/migrations/0073_devis_par_son_lien.sql \
  "     and d.contenu ->> 'clientId' = l.client_v10
" "" \
  "$DV1"
prouver "l'espace qui montre un devis en brouillon" base/migrations/0073_devis_par_son_lien.sql \
  "     and coalesce(d.contenu ->> 'status', 'brouillon') <> 'brouillon'
" "" \
  "$DV1"
prouver "le lien d'un devis qui montre tous les devis du client" base/migrations/0073_devis_par_son_lien.sql \
  "     and (l.piece_v10 is null or d.cle = l.piece_v10)
" "" \
  "$DV1"
prouver "l'espace qui ne rend pas les devis" base/migrations/0073_devis_par_son_lien.sql \
  "    'devis', ventes.devis_du_lien(l.id));" "    'devis', '[]'::jsonb);" \
  "$DV1"
prouver "le lien donné pour le devis d'un autre client" serveur/ventes/routes.ts \
  "and contenu ->> 'clientId' = \$3\`," "and \$3::text is not null\`," \
  "$DV1"
prouver "le lien d'un devis en brouillon donné hors d'un envoi" serveur/ventes/routes.ts \
  "=== 'brouillon' && !corps.canal))" "=== 'brouillon' && false))" \
  "$DV1"
prouver "un devis expiré qui se dit en attente" serveur/ventes/espace.ts \
  "  return typeof d.dueDate === 'string' && d.dueDate !== '' && d.dueDate < aujourdhui ? 'expire' : 'en_attente';" "  return 'en_attente';" \
  "$DV1"
prouver "le devis entier qui part au client (prix de revient, affaire, e-mails)" serveur/ventes/espace.ts \
  "statut: etatDevis(doc, aujourdhui), document: nettoyerPiece(d.document) };" "statut: etatDevis(doc, aujourdhui), document: d.document };" \
  "$DV1"
prouver "les conditions d'un devis qui ne partent pas" serveur/ventes/espace.ts \
  "  'quoteTerms', 'quoteTermsEn',
" "" \
  "$DV2"
prouver "l'e-mail d'un devis sans son lien" web/public/v10/app.js \
  "créé à l'envoi par le point de contact (brique 79) ; un devis aussi (le devis par son lien).
    const lien = !!bridge.ajouterLien && (C.isLocked(doc) || doc.type === 'devis')" "créé à l'envoi par le point de contact (brique 79) ; un devis aussi (le devis par son lien).
    const lien = !!bridge.ajouterLien && (C.isLocked(doc))" \
  "$DV3"
prouver "le WhatsApp d'un devis sans son lien" web/public/v10/app.js \
  "d'un devis aussi (le devis par son lien).
    const lien = !!bridge.ajouterLien && (C.isLocked(doc) || doc.type === 'devis')" "d'un devis aussi (le devis par son lien).
    const lien = !!bridge.ajouterLien && (C.isLocked(doc))" \
  "$DV3"
prouver "la fenêtre d'un devis qui promet « ce qu'il en doit »" web/public/v10/app.js \
  "et ton client y voit la pièce telle que tu l\\'imprimes' + (doc.type === 'devis' ? '.' : ', et ce qu\\'il en doit.') : 'Le message s" "et ton client y voit la pièce telle que tu l\\'imprimes, et ce qu\\'il en doit.' : 'Le message s" \
  "$DV3"
prouver "« Lien pour le client… » absent d'un devis envoyé" web/public/v10/app.js \
  "((locked && (isInv || isAv)) || (doc.type === 'devis' && doc.status !== 'brouillon'))" "(locked && (isInv || isAv))" \
  "$DV3"
prouver "« Pour voir la facture en ligne » sous un devis" web/public/plateforme/pont.js \
  "(devis ? 'le devis' : avoir ?" "(avoir ?" \
  "$DV3"
prouver "le client qui lit un devis sans les conditions par défaut" web/public/espace/espace.js \
  "entreprise: C.migrateData({ company: decoder(lu.entreprise) }).company," "entreprise: decoder(lu.entreprise)," \
  "$DV3"
prouver "le lien d'un devis qui s'ouvre sur un relevé vide" web/public/espace/espace.js \
  "    else if (vue.lien === 'piece' && vue.devis[0]) devis(vue.devis[0], false);
" "" \
  "$DV3"
prouver "le relevé du compte sans ses devis" web/public/espace/espace.js \
  "\${vue.devis.length ? \`<h2 class=\"titre-devis\">" "\${false ? \`<h2 class=\"titre-devis\">" \
  "$DV3"

# ── Le lot caisse (3) (06/10/2026) : le prix d'étiquette fait foi (K5), « Créer la caisse » sous le refus (K1), les
#    boutons d'une fenêtre au bas de la tablette (K4) ; docs/caisse.md.
KB1='20 000 tickets « prix TTC » tirés au hasard (remises, taux, quantités) tombent sur le même millime dans les deux moteurs'
KB2="un ticket « prix TTC » : quantité × prix d'étiquette, au millime, quel que soit le prix et la quantité ; HT + TVA = TTC"
KT1="au comptoir, le prix d'étiquette fait foi : 2 biscuits à 1,200 font 2,400, et leur retour rend 2,400"
KW1="à la tablette du comptoir : 2 biscuits à 1,200 font 2,400 ; « Créer la caisse » sous le refus ; « Enregistrer » au bas d'une longue fenêtre"
prouver "le ticket calculé HT d'abord, à l'écran" web/public/v10/core.js \
  "    const prixTtc = doc.prixTtc === true;" "    const prixTtc = false;" \
  "$KB2"
prouver "le ticket calculé HT d'abord, au serveur" moteur/piece.ts \
  "  if (p.prixTtc) return calculerPieceTtc(p);
" "" \
  "$KB2"
prouver "le panier de la caisse au HT d'abord (2 × 1,200 = 2,399)" web/public/v10/core.js \
  "    const doc = { type: 'facture', ticket: true, prixTtc: true, lines: lignes || []," "    const doc = { type: 'facture', ticket: true, lines: lignes || []," \
  "$KW1"
prouver "le ticket encaissé sans son drapeau « prix TTC »" web/public/v10/core.js \
  "      id: uid(), type: 'facture', ticket: true, prixTtc: true, number: nextNumber(data, 'ticket', jour)," "      id: uid(), type: 'facture', ticket: true, number: nextNumber(data, 'ticket', jour)," \
  "$KW1"
prouver "l'avoir d'un retour qui ne suit pas son ticket « prix TTC »" serveur/caisse/retour.ts \
  "const document = { ...av, prixTtc: tk.contenu.prixTtc === true ? true : undefined, clientId," "const document = { ...av, clientId," \
  "$KT1"
prouver "une facture qui se calcule TTC d'abord parce que l'écran le dit" serveur/v10/dossier.ts \
  "    ...((ticket || retour) && doc.prixTtc === true ? { prixTtc: true } : {})," "    ...(doc.prixTtc === true ? { prixTtc: true } : {})," \
  "$KT1"
prouver "le drapeau « prix TTC » perdu au serveur" serveur/ventes/pieces.ts \
  "prix_ttc: b.prixTtc === true," "prix_ttc: false," \
  "$KT1"
prouver "une remise d'un millime inventée sur un ticket sans remise (écran)" web/public/v10/core.js \
  "    const totalHT = prixTtc ? rd(Object.keys(brutParTaux)" "    const totalHT = false ? rd(Object.keys(brutParTaux)" \
  "$KB1"
prouver "une remise d'un millime inventée sur un ticket sans remise (serveur)" moteur/piece.ts \
  "  const totalHT = [...brutParTaux].reduce((t, [taux, ttc]) => t + ttc - diviserArrondi(ttc * taux, MILLION + taux), 0n);" "  const totalHT = lignes.reduce((t, l) => t + l.ht, 0n);" \
  "$KB1"
prouver "« Aucun compte de caisse » sous le ticket, sans le bouton qui la crée" web/public/v10/app.js \
  "\${s.panier.length && motif && sansCompte ? ' <button" "\${false ? ' <button" \
  "$KW1"
prouver "« Enregistrer » caché sous le bas d'une fenêtre, à la tablette" web/public/plateforme/telephone.css \
  "  .modal > .modal-actions:last-child { position: sticky; bottom: -26px;" "  .modal > .modal-actions:last-child { position: static; bottom: -26px;" \
  "$KW1"

# Le lot débutant (1) (06/10/2026) : un commerçant qui débute, à la souris, sur app.skanfact.tn (docs/debutant.md).
KD1="Paramètres : la recherche ne compte que ce qu'elle montre ; le bandeau se redessine ; « Ta fiche est à jour » exige un matricule complet"
KD2="Stock : à date égale, les mouvements se lisent dans l'ordre où ils ont eu lieu ; Comptabilité : « Préparer » ouvre le mois déclaré"
KD3="Dépense : elle se saisit par ce qu'on a payé ; le hors taxes s'en déduit au millime, et suit le taux"
KD4="Avoir : émis sur une facture payée, il porte « Rembourser … au client », qui enregistre le remboursement sur la facture"
KDT="la pièce signée attend le compte El Fatoora ; Nadia le pose depuis la fenêtre ; acceptée, la facture validée se télécharge, et la pièce imprimée porte sa référence et son code QR, jusque dans l'espace client"
KDK="Nadia branche Konnect ; son client paie sa facture en ligne ; le paiement arrive sur la facture"
KDP="du compte à la facture émise par le serveur, retrouvée après rechargement, puis le retour d'un autre appareil"
KDE="la facture part avec son lien, par e-mail puis par WhatsApp ; le devis aussi ; le relevé part sans rien de joint"
KDL="Nadia photographie la facture : la fenêtre montre ce qui a été lu, où, et le total recompté ; enregistré, l'achat tombe au millime sur la pièce"
prouver "le mot de passe de SkanFact posé par Chrome dans celui d'El Fatoora" web/public/plateforme/pont.js \
  '<input data-champ="motDePasse" type="password" autocomplete="new-password"' '<input data-champ="motDePasse" type="password" autocomplete="off"' \
  "$KDT"
prouver "le mot de passe de SkanFact posé par Chrome dans la clé Konnect" web/public/plateforme/pont.js \
  '<input data-champ="cle" type="password" autocomplete="new-password"' '<input data-champ="cle" type="password" autocomplete="off"' \
  "$KDK"
prouver "la recherche des réglages compte des panneaux absents" web/public/v10/app.js \
  "      exclus: bridge.panneauxAbsents || []," "      exclus: []," \
  "$KD1"
prouver "le bandeau « Il manque » qui ne se redessine pas à l'enregistrement" web/public/v10/app.js \
  "      if (\$('#set-manque-zone')) \$('#set-manque-zone').innerHTML = bandeauManques(C.companyGaps(company()));" "      if (false) \$('#set-manque-zone').innerHTML = bandeauManques(C.companyGaps(company()));" \
  "$KD1"
prouver "« Ta fiche est à jour » avec un matricule incomplet" web/public/v10/visites.js \
  "        && K.matriculeBienForme(c.matricule) && !(String(c.rib" "        && !(String(c.rib" \
  "$KD1"
prouver "le stock de départ rangé au-dessus de la casse du même jour" web/public/v10/core.js \
  "|| (rang.get(b) - rang.get(a)) || String(b.id)" "|| String(b.id)" \
  "$KD2"
prouver "« Préparer » la TVA ouvre le mois de l'échéance" web/public/v10/app.js \
  "comptaState.year = String(m === 1 ? y - 1 : y); comptaState.month = String(m === 1 ? 12 : m - 1).padStart(2, '0');" "comptaState.year = String(y); comptaState.month = String(m).padStart(2, '0');" \
  "$KD2"
prouver "le montant payé d'une dépense sans effet" web/public/v10/app.js \
  "    if (\$('#b-ttc')) \$('#b-ttc').addEventListener('input', appliquerTtc);" "    if (false) \$('#b-ttc').addEventListener('input', appliquerTtc);" \
  "$KD3"
prouver "le hors taxes d'une dépense qui ne suit pas le taux choisi" web/public/v10/app.js \
  "if (e.target.matches('select[data-k=vatRate]')) appliquerTtc();" "if (false) appliquerTtc();" \
  "$KD3"
prouver "le montant payé qui reste affiché sous un hors taxes tapé à la main" web/public/v10/app.js \
  "if (e.target.matches('input[data-k=unitPrice]') && \$('#b-ttc')) { \$('#b-ttc').value = '';" "if (false) { \$('#b-ttc').value = '';" \
  "$KD3"
prouver "l'avoir d'une facture payée sans « Rembourser … au client »" web/public/v10/app.js \
  "            return bf && bf.remaining < -0.0005 ? \`<button" "            return false ? \`<button" \
  "$KD4"
prouver "l'e-mail noté « envoyé » sans que personne ne le dise" web/public/v10/app.js \
  "          \$('#mf-envoye', root).onclick = () => {|||          \$('#mf-copier-adresse', root).onclick = " "          const envoye = () => {|||          setTimeout(() => envoye()); \$('#mf-copier-adresse', root).onclick = " \
  "$KDE"
prouver "une ligne lue d'un article suivi qui part en charge, pas au stock" web/public/v10/app.js \
  "        if (it) Object.assign(l, { itemId: it.id, destination: 'stock' });" "        if (false) Object.assign(l, { itemId: it.id, destination: 'stock' });" \
  "$KDL"
prouver "le code du téléphone qu'il faut cliquer avant de taper" web/src/composants/Champ.tsx \
  "  useEffect(() => { if (premier) f.ref.current?.focus(); }, [premier, f.ref]);" "  useEffect(() => { if (premier && false) f.ref.current?.focus(); }, [premier, f.ref]);" \
  "$KDP"
prouver "le téléphone perdu caché dans la bulle « i »" web/src/ecrans/Code.tsx \
  '<button type="button" id="code-perdu"' '<button type="button" id="code-cache"' \
  "$KDP"

# Le lot entrée (06/10/2026) : l'entrée refaite d'après les maquettes, et le mot de passe oublié (docs/entree.md).
KE1="sans relais d'e-mails, l'entrée ne le propose pas, et la demande se refuse en le disant"
KE2="la même réponse qu'un compte existe ou non ; le lien part à l'adresse du compte, avec lui seul ; trois demandes par heure au plus"
KE3="sans code du téléphone : le lien choisit un nouveau mot de passe (la règle des mots de passe tient), une fois, 30 minutes ; les sessions ouvertes se ferment"
KE4="avec le code du téléphone, le lien seul ne suffit pas : il faut le code, ou un code de secours (une fois) ; cinq codes faux, et le lien ne vaut plus rien"
KEW1="mot de passe oublié : proposé seulement si l'e-mail peut partir ; le lien reçu choisit un nouveau mot de passe, qui ouvre ensuite le compte"
KEW2="créer son compte : la jauge dit pendant la frappe ce qui manque, « Afficher » montre le mot de passe"
KEW3="ton entreprise : la forme du matricule se dit pendant la frappe, et le haut de la facture se dessine avec ce qui est tapé"
KEW4="la sécurité du comptable d'un cabinet : son cabinet se dit ; les codes de secours se copient et se téléchargent ; l'ouverture coche ce qui est fait"
prouver "le mot de passe oublié proposé sans relais d'e-mails (serveur)" serveur/routes/socle.ts \
  "traiter: async () => ({ corps: { motDePasseOublie: !!ctx.courriel, codeParCourriel: !!ctx.courriel } })," "traiter: async () => ({ corps: { motDePasseOublie: true, codeParCourriel: !!ctx.courriel } })," \
  "$KE1"
prouver "la demande du mot de passe oublié qui dit si l'adresse a un compte" serveur/connexion.ts \
  "  if (!a) return;" "  if (!a) throw new Refus('connexion.oubli_indisponible');" \
  "$KE2"
prouver "le mot de passe oublié demandé sans limite" base/migrations/0075_mot_de_passe_oublie.sql \
  "r.cree_le > p_maintenant - interval '1 hour') >= 3 then return; end if;" "r.cree_le > p_maintenant - interval '1 hour') >= 300 then return; end if;" \
  "$KE2"
prouver "le lien du mot de passe oublié qui ne périme pas" base/migrations/0075_mot_de_passe_oublie.sql \
  "values (v_id, p_empreinte, p_maintenant, p_maintenant + p_duree);" "values (v_id, p_empreinte, p_maintenant, p_maintenant + interval '1 day');" \
  "$KE3"
prouver "les sessions ouvertes qui survivent au nouveau mot de passe" base/migrations/0075_mot_de_passe_oublie.sql \
  "  update socle.session set fermee_le = p_maintenant where utilisateur = v_utilisateur and fermee_le is null;" "" \
  "$KE3"
prouver "la règle des mots de passe oubliée au mot de passe oublié" serveur/connexion.ts \
  "  if (!politique.ok) return { ok: false, motif: politique.motif, champ: 'motDePasse' };" "" \
  "$KE3"
prouver "le lien seul qui suffit à un compte protégé par le code du téléphone" serveur/connexion.ts \
  "  if (lu.code_methode === 'sms' || lu.code_methode === 'application') {" "  if (false) {" \
  "$KE4"
prouver "les codes faux sans effet sur le lien du mot de passe oublié" serveur/connexion.ts \
  "      await enTantQue(ctx.pool, null, (tx) => tx.query('select socle.reinitialisation_erreur(\$1)', [e]));" "" \
  "$KE4"
prouver "un code de secours qui sert deux fois au mot de passe oublié" serveur/connexion.ts \
  "    if (secours && !(await tx.query('select socle.consommer_code_secours(\$1, \$2) ok', [secours, maintenant])).rows[0].ok) return false;" "" \
  "$KE4"
prouver "« Mot de passe oublié ? » proposé sans relais d'e-mails" web/src/ecrans/Connexion.tsx \
  "{options.oubli ? <div className=\"ent-sous-champ\">" "{true ? <div className=\"ent-sous-champ\">" \
  "$KEW1"
prouver "le jeton du mot de passe oublié qui reste dans l'adresse" web/src/App.tsx \
  "  q.delete('reinitialiser');" "" \
  "$KEW1"
prouver "la jauge du mot de passe qui ne suit pas la frappe" web/src/ecrans/Inscription.tsx \
  "  const n = [...motDePasse].length;" "  const n = [...motDePasse].length * 0;" \
  "$KEW2"
prouver "« Afficher » qui ne montre pas le mot de passe" web/src/composants/Champ.tsx \
  "type={revelable && vu ? 'text' : type}" "type={type}" \
  "$KEW2"
prouver "le matricule sans sa suite, qui ne dit pas ce qui manque" web/src/ecrans/Porte.tsx \
  "  if (matriculeSansSuite(m)) return { texte: phrase('ecran.porte.mf_debut'), classe: ' alerte' };" "" \
  "$KEW3"
prouver "le haut de la facture qui ne suit pas la raison sociale" web/src/ecrans/Porte.tsx \
  "{raison.trim() ? <strong data-donnee>{raison.trim()}</strong>" "{false ? <strong data-donnee>{raison.trim()}</strong>" \
  "$KEW3"
prouver "le cabinet, que l'écran de la sécurité tait" web/src/ecrans/CodeRequis.tsx \
  "bandeau={cabinet ? titre('ecran.code_requis.cabinet', { nom: cabinet }) : undefined}" "bandeau={undefined}" \
  "$KEW4"
prouver "les codes de secours copiés à moitié" web/src/ecrans/CodeRequis.tsx \
  "void copier(codes.secours.join('\n')," "void copier(codes.secours.slice(5).join('\n')," \
  "$KEW4"
prouver "les codes de secours téléchargés sous un nom quelconque" web/src/ecrans/CodeRequis.tsx \
  "  lien.download = 'skanfact-codes-de-secours.txt';" "  lien.download = 'codes.txt';" \
  "$KEW4"
prouver "l'ouverture qui tait la protection du compte" web/src/ecrans/Ouverture.tsx \
  "...(ouvrir.protege ? ['ecran.ouverture.protege'] : [])" "...([])" \
  "$KEW4"
prouver "l'écran qui part sans les codes de secours mis de côté" web/src/ecrans/CodeRequis.tsx \
  "    if (!garde) { toast(" "    if (false) { toast(" \
  "le refus montre la case"
prouver "le téléphone perdu qui ne fait pas taper un code de secours" web/src/ecrans/Code.tsx \
  "onClick={() => { setSecours(!secours); setCode(''); }}" "onClick={() => { setCode(''); }}" \
  "$PARC"
# Ce que le parcours sur app.skanfact.tn a relevé une fois l'entrée en ligne (06/10/2026).
KEW5="l'entrée ne bouge pas sous la frappe et dit vrai : la clé se coupe entre ses groupes, le refus montre la case, rien ne se dit fait avant la vérification"
prouver "la page des étapes centrée en hauteur, qui bouge quand une aide change de taille" web/src/entree.css \
  "display: flex; flex-direction: column; justify-content: flex-start; gap: 32px; }" "display: flex; flex-direction: column; justify-content: center; gap: 32px; }" \
  "$KEW5"
prouver "la clé du code coupée au milieu d'un groupe" web/src/entree.css \
  "letter-spacing: .06em; word-break: normal; overflow-wrap: anywhere; user-select: all;" "letter-spacing: .06em; word-break: break-all; user-select: all;" \
  "$KEW5"
prouver "le bouton « Vérifier » qui se déplace quand la case se coche" web/src/entree.css \
  ".ent-pose-pied { flex: 1 1 100%; display: flex;" ".ent-pose-pied { display: flex;" \
  "$KEW5"
prouver "« parfait » dit avant que le code soit vérifié" web/src/textes.ts \
  "'ecran.code_pose.garde_ok': 'codes mis de côté : il reste à taper le code que montre l\\'application, puis à vérifier'," "'ecran.code_pose.garde_ok': 'parfait : le code sera demandé à chaque connexion'," \
  "$KEW5"
prouver "le refus sans la case à cocher qui ne montre pas la case" web/src/ecrans/CodeRequis.tsx \
  "toast(phrase('ecran.code_pose.garde_avant'), true); setACocher(true);" "toast(phrase('ecran.code_pose.garde_avant'), true);" \
  "$KEW5"
prouver "le haut de la facture dit « à côté » au téléphone, où il est dessous" web/src/textes.ts \
  "regarde-le se dessiner pendant que tu tapes'," "regarde-le se dessiner à côté'," \
  "$KEW5"

# ── Le relais d'e-mails du serveur d'essai : Resend (09/10/2026 ; docs/mise-en-ligne.md, H) ──
RC1="la clé ne paraît sur aucune ligne de commande ; l'essai passe, puis les deux réglages remplacent les anciens et SkanFact redémarre"
RC2="Resend refuse l'essai : rien ne change sur le serveur, et l'écran dit pourquoi le plus souvent"
RC4="un serveur qui n'est pas d'essai le refuse : son relais sera en Tunisie"
prouver "la clé de Resend sur la ligne de commande de curl" exploitation/courriel.sh \
  'printf '"'"'user = "resend:%s"\n'"'"' "$CLE" | curl -sS --ssl-reqd' 'printf '"'"'user = "resend:%s"\n'"'"' "$CLE" | curl -sS --user "resend:$CLE" --ssl-reqd' \
  "$RC1"
prouver "les réglages écrits même quand Resend refuse l'essai" exploitation/courriel.sh \
  'Rien n'"'"'a changé sur le serveur." >&2
  exit 1' 'Rien n'"'"'a changé sur le serveur." >&2' \
  "$RC2"
prouver "l'ancien relais gardé à côté du nouveau" exploitation/courriel.sh \
  "grep -v -e '^SKANFACT_SMTP=' -e '^SKANFACT_COURRIEL_DE=' \"\$REGLAGES\"" 'cat "$REGLAGES"' \
  "$RC1"
prouver "Resend branché sur un serveur aux vraies données" exploitation/courriel.sh \
  "grep -qx 'SKANFACT_ENVIRONNEMENT=test' \"\$REGLAGES\" ||" 'true ||' \
  "$RC4"

# ── Le lot onboarding : le code par e-mail, Ton compte (0076 ; serveur/connexion.ts, serveur/compte.ts) ──
C76=base/migrations/0076_code_facultatif.sql
CX=serveur/connexion.ts
CO=serveur/compte.ts
CE1="à la première connexion, l'adresse se vérifie par un code reçu par e-mail"
CE2="sans code du téléphone, un appareil inconnu (ou le poste d'un autre) demande un code par e-mail"
CE4="renvoyer le code : pas avant 30 secondes, cinq envois au plus"
prouver "le code par e-mail jamais demandé" $CX \
  "    if (!aUnCode && ctx.courriel) {" "    if (false) {" \
  "$CE1"
prouver "un code par e-mail demandé sans relais" $CX \
  "    if (!aUnCode && ctx.courriel) {" "    if (!aUnCode) {" \
  "$CE1"
prouver "un appareil reconnu à qui l'on redemande le code par e-mail" $CX \
  "      if (!verifiee || !(reconnu && !posteDUnAutre)) {" "      if (true) {" \
  "$CE1"
prouver "un appareil inconnu qui entre sans code par e-mail" $CX \
  "      if (!verifiee || !(reconnu && !posteDUnAutre)) {" "      if (!verifiee) {" \
  "$CE2"
prouver "l'adresse jamais prouvée par le code reçu" $CX \
  "    if (lu.methode === 'courriel') await tx.query('select socle.prouver_adresse(\$1, \$2)', [demande.defi, maintenant]);" "" \
  "$CE1"
prouver "un code par e-mail valable une heure" $CX \
  "const DUREE_DEFI_COURRIEL_MINUTES = 15;" "const DUREE_DEFI_COURRIEL_MINUTES = 60;" \
  "$CE4"
prouver "un code renvoyé sans attendre" $C76 \
  "coalesce(d.envoye_le, d.cree_le) <= p_maintenant - interval '30 seconds'" "coalesce(d.envoye_le, d.cree_le) <= p_maintenant" \
  "$CE4"
prouver "des renvois sans fin" $C76 \
  "     and d.envois < 5 and coalesce(" "     and d.envois < 500 and coalesce(" \
  "$CE4"
prouver "l'ancien code valable après un renvoi" $C76 \
  "  update socle.defi_connexion d set code_empreinte = p_empreinte, envois = d.envois + 1" "  update socle.defi_connexion d set code_empreinte = d.code_empreinte, envois = d.envois + 1" \
  "$CE4"
RT1="il faut le code du moment ou un code de secours ; un e-mail le confirme"
RT4="les erreurs comptent comme à la connexion : une attente qui s'allonge"
prouver "le code du téléphone retiré sans le prouver" $CO \
  "  if (!await monCodeEstBon(ctx, qui, code)) return erreur(ctx, email, { ok: false, motif: motif('connexion.code_faux'), champ: 'code' });
  const a = await" "  const a = await" \
  "$RT1"
prouver "le code retiré sans e-mail qui le confirme" $CO \
  "    void courriel.envoi.envoyer({
      a, objet: rendre(t('compte.code_retire_objet')" "    void Promise.resolve({
      a, objet: rendre(t('compte.code_retire_objet')" \
  "$RT1"
prouver "les codes de secours gardés après le retrait" $C76 \
  "  delete from socle.code_secours where utilisateur = socle.moi();
  perform socle.tracer(null, 'compte.code.retirer'" "  perform socle.tracer(null, 'compte.code.retirer'" \
  "$RT1"
prouver "un comptable de cabinet qui retire son code" $C76 \
  "    perform socle.refus('le code du téléphone est exigé de chaque comptable d''un cabinet : il ne se retire pas');" "" \
  "un comptable de cabinet ne retire pas son code : il lui est exigé"
prouver "le bon code accepté pendant l'attente" $CO \
  "  if (bloque) return bloque;
  if (!await monCodeEstBon(ctx, qui, code)) return erreur(ctx, email, { ok: false, motif: motif('connexion.code_faux'), champ: 'code' });
  const a = await" "  if (!await monCodeEstBon(ctx, qui, code)) return erreur(ctx, email, { ok: false, motif: motif('connexion.code_faux'), champ: 'code' });
  const a = await" \
  "$RT4"
prouver "les erreurs de code jamais comptées" $CO \
  "(await tx.query('select socle.noter_erreur(\$1, \$2) a', [email, maintenant])).rows[0].a as Date | null);" "(await tx.query('select null::timestamptz a')).rows[0].a as Date | null);" \
  "$RT4"
prouver "les anciens codes de secours valables après le renouvellement" $C76 \
  "  delete from socle.code_secours where utilisateur = socle.moi();
  insert into socle.code_secours (utilisateur, empreinte) select socle.moi(), e from unnest(p_empreintes) e;
  perform socle.tracer(null, 'compte.code.secours'" "  insert into socle.code_secours (utilisateur, empreinte) select socle.moi(), e from unnest(p_empreintes) e;
  perform socle.tracer(null, 'compte.code.secours'" \
  "avec le code du moment ; les anciens ne valent plus"
MP="l'actuel d'abord, puis la même règle qu'à l'inscription ; les autres sessions se ferment, pas celle-ci"
prouver "le mot de passe changé sans l'actuel" $CO \
  "  if (!await motDePasseBon(ctx, email, actuel)) return erreur(ctx, email, { ok: false, motif: motif('compte.mot_de_passe_actuel_faux'), champ: 'actuel' });" "" \
  "$MP"
prouver "les autres sessions gardées au changement de mot de passe" $C76 \
  "  update socle.session set fermee_le = p_maintenant where utilisateur = socle.moi() and fermee_le is null and id <> p_session;" "" \
  "$MP"
prouver "la session en cours fermée au changement de mot de passe" $C76 \
  "and fermee_le is null and id <> p_session;" "and fermee_le is null;" \
  "$MP"
AD1="avec un relais : un code à la nouvelle adresse, puis elle remplace l'ancienne"
prouver "l'adresse changée sans le code reçu à la nouvelle" $CO \
  "  if (!courriel) {
    await enTantQue(ctx.pool, qui.utilisateur, (tx) => tx.query('select socle.changer_adresse_sans_code(\$1)', [adresse]));" "  if (courriel || !courriel) {
    await enTantQue(ctx.pool, qui.utilisateur, (tx) => tx.query('select socle.changer_adresse_sans_code(\$1)', [adresse]));" \
  "$AD1"
prouver "l'adresse changée avec un code faux" $C76 \
  "  if c.code_empreinte <> p_empreinte then" "  if false then" \
  "$AD1"
prouver "l'ancienne adresse jamais prévenue" $CO \
  "    void courriel.envoi.envoyer({
      a: ancienne," "    void Promise.resolve({
      a: ancienne," \
  "$AD1"
prouver "l'adresse d'un autre compte acceptée" $C76 \
  "  if exists (select 1 from socle.utilisateur u where lower(u.email) = lower(trim(p_adresse)) and u.id <> socle.moi()) then" "  if false then" \
  "une adresse déjà celle d'un autre compte se refuse"
prouver "une adresse changée sans code dite vérifiée" $C76 \
  "  update socle.utilisateur set email = lower(trim(p_nouvelle)), adresse_verifiee_le = null where id = socle.moi();" "  update socle.utilisateur set email = lower(trim(p_nouvelle)) where id = socle.moi();" \
  "sans relais : on ne sait rien envoyer, l'adresse change tout de suite et reste à vérifier"
CR="« Ce n'est pas ton adresse ? La corriger » : pendant le défi de l'inscription seulement"
prouver "une adresse prouvée corrigée par un défi" $C76 \
  "     and d.envois < 5 and u.adresse_verifiee_le is null" "     and d.envois < 5" \
  "$CR"
prouver "l'adresse d'un autre compte prise à la correction" $C76 \
  "  if exists (select 1 from socle.utilisateur u where lower(u.email) = lower(trim(p_adresse)) and u.id <> v_utilisateur) then" "  if false then" \
  "$CR"
prouver "l'ancien code valable après la correction" $C76 \
  "  update socle.defi_connexion set code_empreinte = p_empreinte, envois = envois + 1," "  update socle.defi_connexion set code_empreinte = code_empreinte, envois = envois + 1," \
  "$CR"
prouver "le code de la correction jamais envoyé" $CX \
  "  envoyerCodeParCourriel(ctx, nouvelle, code, 'inscription');" "" \
  "$CR"
AC1="rien ne change avant le premier code juste : une activation abandonnée ne ferme pas la porte"
AC2="une page rechargée garde le même secret, avec de nouveaux codes de secours ; après une heure, on recommence"
AC3="qui a déjà un code prouve l'actuel avant d'en préparer un autre (changer de téléphone)"
prouver "le code préparé posé tout de suite" $C76 \
  "  update socle.utilisateur set code_secret_attente = p_secret," "  update socle.utilisateur set code_methode = 'application', code_secret = p_secret, code_secret_attente = p_secret," \
  "$AC1"
prouver "le code activé sans le premier code juste" $CO \
  "    if (!/^[0-9]{6}\$/.test(saisi) || !verifierTotp(secret, saisi, maintenant.getTime())) return { ok: false, motif: motif('compte.code_essai_faux'), champ: 'code' };" "" \
  "$AC1"
prouver "les codes de secours préparés jamais posés" $C76 \
  "  insert into socle.code_secours (utilisateur, empreinte) select socle.moi(), e from unnest(v_secours) e;" "" \
  "$AC1"
prouver "l'activation du code jamais tracée" $C76 \
  "  perform socle.tracer(null, 'compte.code.activer', 'utilisateur', socle.moi(), null, jsonb_build_object('methode', 'application'));" "" \
  "$AC1"
prouver "un code préparé valable sans fin" $C76 \
  "   where u.id = socle.moi() and u.code_attente_le > p_maintenant - interval '1 hour'
\$\$;" "   where u.id = socle.moi()
\$\$;" \
  "$AC2"
prouver "une page rechargée qui change de secret" $CO \
  "?? nouveauSecret();" ";" \
  "$AC2"
prouver "les codes de secours de la première préparation gardés" $C76 \
  "code_secours_attente = p_empreintes_secours," "code_secours_attente = coalesce(code_secours_attente, p_empreintes_secours)," \
  "$AC2"
prouver "changer de téléphone sans prouver l'actuel" $CO \
  "    if (!await monCodeEstBon(ctx, qui, code)) return erreur(ctx, email, { ok: false, motif: motif('connexion.code_faux'), champ: 'code' });
    await enTantQue" "    await enTantQue" \
  "$AC3"
prouver "changer de téléphone sans même un code" $CO \
  "    if (!code?.trim()) return { ok: false, motif: motif('compte.code_actuel_manque'), champ: 'code' };" "" \
  "$AC3"
prouver "l'ancien téléphone valable après le changement" $C76 \
  "  update socle.utilisateur set code_methode = 'application', code_secret = v_secret," "  update socle.utilisateur set code_methode = 'application', code_secret = coalesce(code_secret, v_secret)," \
  "$AC3"
prouver "le code posé d'un coup qui remplace un code actif" $C76 \
  "    perform socle.refus('le code du téléphone est déjà activé : pour changer de téléphone, passe par Ton compte');" "" \
  "le code posé d'un coup (gardé pour l'API) ne remplace pas un code actif"
prouver "la session réduite gardée après l'activation" $C76 \
  "  update socle.session set code_a_configurer = false where utilisateur = socle.moi() and fermee_le is null;
  perform socle.tracer(null, 'compte.code.activer'" "  perform socle.tracer(null, 'compte.code.activer'" \
  "un comptable de cabinet sans code : l'activation lève la session réduite"

# Les écrans du lot onboarding (09/10/2026) : Ton compte (compte.js, partagé par l'entreprise et le Cabinet), le code
# reçu par e-mail (CodeCourriel.tsx), et l'écran du code gardé dans l'onglet (App.tsx).
CPTJS=web/public/plateforme/compte.js
CPTE="de nouveaux codes de secours, puis le code désactivé"
CPTC="le Cabinet : le code est exigé et ne se désactive pas"
prouver "le code activé sans les codes de secours mis de côté" $CPTJS \
  "          if (!\$('#cpt-garde').checked) {" "          if (false) {" \
  "$PARC"
prouver "le refus caché sous le bord de la fenêtre" $CPTJS \
  "    if (alerte && alerte.textContent) alerte.scrollIntoView({ block: 'nearest' });" "" \
  "$PARC"
prouver "un code QR de Ton compte qui ne dit pas l'adresse" $CPTJS \
  "    q.addData(adresse);" "    q.addData(adresse.replace('SkanFact', 'Skan'));" \
  "$PARC"
prouver "la clé de Ton compte qui n'est pas celle du code QR" $CPTJS \
  "<code>\${esc(parQuatre(r.cle))}</code>" "<code>\${esc(parQuatre(r.cle.slice(1)))}</code>" \
  "$PARC"
prouver "le lien de Ton compte qui n'ouvre pas l'application" $CPTJS \
  "<p><a href=\"\${esc(r.adresseApplication)}\">" "<p><a href=\"#\">" \
  "$PARC"
prouver "le code exigé d'un comptable de cabinet, désactivable à l'écran" $CPTJS \
  "c.codeExige ? '' : '<button" "false ? '' : '<button" \
  "$CPTC"
prouver "le refus du mot de passe qui ne montre pas sa case" $CPTJS \
  "refuser(racine, x, { actuel: '#cpt-actuel', nouveau: '#cpt-nouveau' })" "refuser(racine, x)" \
  "$CPTE"
prouver "l'adresse dite changée avant le code reçu" $CPTJS \
  "if (!r.demande) { fermer(); o.toast('Adresse changée.'); fini(); return; }" "{ fermer(); o.toast('Adresse changée.'); fini(); return; }" \
  "$CPTE"
prouver "l'onglet Ton compte absent des Paramètres" web/public/v10/app.js \
  "const SETTINGS_TABS = [...(bridge.dessinerCompte ? [['compte', 'Ton compte']] : []), " "const SETTINGS_TABS = [" \
  "$CPTE"
prouver "l'onglet Ton compte absent des Réglages du Cabinet" web/public/v10/cabinet/app.js \
  "const REG_TABS = [['compte', 'Ton compte'], " "const REG_TABS = [" \
  "$CPTC"
prouver "l'écran du code perdu au rechargement" web/src/App.tsx \
  "if (a.ecran === 'code') defiEnCours.garder(a.defi); else defiEnCours.oublier();" "defiEnCours.oublier();" \
  "tient au rechargement"
prouver "l'adresse corrigée oubliée au rechargement" web/src/App.tsx \
  "corrige={(adresse) => { if (defi.methode === 'courriel') setAccueil({ ecran: 'code', defi: { ...defi, adresse } }); }}" "corrige={() => undefined}" \
  "tient au rechargement"
prouver "l'adresse en entier sur un appareil inconnu" web/src/ecrans/CodeCourriel.tsx \
  "<b data-donnee>{masquer(adresse)}</b>" "<b data-donnee>{adresse}</b>" \
  "le lien reçu choisit un nouveau mot de passe"
prouver "renvoyer le code sans attendre" web/src/ecrans/CodeCourriel.tsx \
  "disabled={decompte.reste > 0 || g.occupe}" "disabled={g.occupe}" \
  "le lien reçu choisit un nouveau mot de passe"
prouver "l'écran du code qui ne nomme pas le cabinet" web/src/App.tsx \
  " cabinet={moi.cabinets[0]?.nom} />" " />" \
  "$KEW4"

# L'assistant de démarrage au nouveau style (lot onboarding, 09/10/2026) : son dessin (plateforme/assistant.js et .css),
# son ouverture dans la v10 (web/v10/assistant.txt), la porte et le point de contact qui le demandent.
ASJS=web/public/plateforme/assistant.js
ASCSS=web/public/plateforme/assistant.css
ASAPP=web/public/v10/app.js
AS1="la porte, puis l'assistant : chaque écran s'écrit et se reprend, la facture de l'aperçu est la vraie, et le métier retenu à la fin décide du catalogue"
AS2="revoir l'assistant : ses réponses y sont, rien ne s'écrit avant la fin, et « Fermer sans rien changer » ne change rien"
AS3="l'assistant est au propriétaire : un membre de l'équipe ne le voit jamais ; une entreprise créée sans la porte s'ouvre sur son accueil"
AS4="au téléphone : aucun écran de l'assistant ne défile de côté, tout se touche du doigt, et « Plus tard » mène au bout"
AS5="ses polices sont celles de l'entrée, à l'octet près, servies comme des polices ; ses couleurs sont les mêmes"
prouver "l'assistant demandé par la porte, jamais ouvert" $ASAPP \
  "    if (bridge.assistantDemande && bridge.assistantDemande()) {" "    if (false) {" \
  "$AS1"
prouver "l'assistant ouvert dans une entreprise créée sans la porte" $ASAPP \
  "    if (bridge.assistantDemande && bridge.assistantDemande()) {" "    if (true) {" \
  "$AS3"
prouver "l'assistant ouvert à un membre de l'équipe" $ASAPP \
  "    if (premierLancement && estResponsable()) {" "    if (premierLancement) {" \
  "$AS3"
prouver "l'accueil qui repose la question de la porte après l'assistant" $ASAPP \
  "      visitesPoser(e => { e.accueilVu = true; });
      if (!data.company.setupDone && !data.company.setupStarted) {" "      if (!data.company.setupDone && !data.company.setupStarted) {" \
  "$AS1"
prouver "la porte qui ne demande pas l'assistant" web/src/ecrans/Porte.tsx \
  "sessionStorage.setItem('skanfact.assistant', r.corps.id);" "void r;" \
  "$AS1"
prouver "l'entreprise créée depuis l'exemple, sans l'assistant" web/public/plateforme/pont.js \
  "      assistantApres(r.id);" "" \
  "quitter l'exemple sans vraie entreprise : son nom d'abord ; la visite part avec l'entreprise créée, jamais avant"
prouver "l'assistant demandé pour une autre entreprise" web/public/plateforme/pont.js \
  "sessionStorage.removeItem(ASSISTANT_APRES); return v === ent;" "sessionStorage.removeItem(ASSISTANT_APRES); return !!v;" \
  "l'assistant de démarrage s'ouvre dans l'entreprise qui l'a demandé, une seule fois, et jamais dans une autre"
prouver "l'assistant demandé qui revient à chaque ouverture" web/public/plateforme/pont.js \
  "sessionStorage.removeItem(ASSISTANT_APRES); " "" \
  "l'assistant de démarrage s'ouvre dans l'entreprise qui l'a demandé, une seule fois, et jamais dans une autre"
prouver "la page rechargée qui recommence l'assistant au début" $ASJS \
  "let i = reprise ? Math.min(Math.max(Number(c0.setupStep) || 0, 0), ETAPES.length - 1) : 0;" "let i = 0;" \
  "$AS1"
prouver "le catalogue versé en route, celui du premier métier cliqué" $ASJS \
  "({ ...a, fillCatalog: false, modules:" "({ ...a, modules:" \
  "$AS1"
prouver "le menu proposé écrit en route, comme s'il était choisi" $ASJS \
  "modules: a.modulesTouche ? a.modules : undefined" "modules: a.modules" \
  "$AS1"
prouver "le régime choisi à la main écrasé par le métier" $ASJS \
  "            a.regimeTouche = true;" "" \
  "$AS1"
prouver "le menu choisi à la main écrasé par le métier" $ASJS \
  "            a.modulesTouche = true;" "" \
  "$AS1"
prouver "une adresse e-mail mal formée acceptée" $ASJS \
  "if (a.email && !" "if (false && !" \
  "$AS1"
prouver "« Continuer » sans métier" $ASJS \
  "          if (!a.activity) {" "          if (false) {" \
  "$AS1"
prouver "le téléphone enregistré sans son indicatif" $ASJS \
  '/^(\+|00)/.test(s) ? s : `${INDICATIF} ${s}`;' '/^(\+|00)/.test(s) ? s : s;' \
  "$AS1"
prouver "le pied de l'aperçu qui n'est pas lu sur la facture" $ASJS \
  "const pied = lignesDe(d.querySelector('.footer .f-left'));" "const pied = [];" \
  "$AS1"
prouver "la colonne TVA dessinée sans TVA" $ASJS \
  "const avecTva = entetes.length >= 5;" "const avecTva = true;" \
  "$AS1"
prouver "revoir l'assistant écrit en route" $ASJS \
  "        if (rejoue) return;" "" \
  "$AS2"
prouver "« Fermer sans rien changer » qui déconnecte" $ASJS \
  "if (rejoue) { fermer(false); return; }" "" \
  "$AS2"
prouver "la sortie qui ne dit pas qu'elle ne change rien" $ASJS \
  "const sortie = rejoue ? 'Fermer sans rien changer' : 'Se déconnecter';" "const sortie = 'Se déconnecter';" \
  "$AS2"
prouver "au téléphone, l'icône à côté du nom du métier" $ASCSS \
  "  #setup.as .as-tuile { flex-direction: column; align-items: flex-start; padding: 12px;" "  #setup.as .as-tuile { padding: 12px;" \
  "$AS4"
prouver "le rembourrage de la page ouverte de la v10 sur l'assistant" $ASCSS \
  "padding: clamp(16px, 4vh, 40px) 0 64px; overflow: visible; " "" \
  "$AS4"
prouver "les polices servies sans leur type" serveur/principal.ts \
  "  '.woff2': 'font/woff2'," "" \
  "$AS5"
prouver "une couleur de l'assistant qui n'est pas celle de l'entrée" $ASCSS \
  "  --e-lien: #0b7a70;" "  --e-lien: #0b7a71;" \
  "$AS5"
prouver "une couleur sombre de l'assistant qui n'est pas celle de l'entrée" $ASCSS \
  "  --e-lien: #7fe0d3;" "  --e-lien: #7fe0d4;" \
  "$AS5"

# Vérifier son adresse sans en changer (lot onboarding, 09/10/2026 ; migration 0077, serveur/compte.ts, Ton compte) :
# qui a le code du téléphone ne reçoit jamais de code par e-mail à la connexion, et son adresse ne se prouvait jamais.
V77=base/migrations/0077_verifier_adresse.sql
VA1="qui a le code du téléphone ne reçoit jamais de code à la connexion : un code part à son adresse et la prouve, tracé « vérifiée », sans avis de changement"
VA2="le code ne prouve que l'adresse où il est parti : changée entre-temps, la demande ne vaut plus ; cinq erreurs, et elle ne vaut plus non plus ; trois demandes par heure"
VA3="une adresse qu'aucune connexion ne vérifie (le code du téléphone actif) se vérifie ici, par un code reçu à cette adresse"
prouver "une adresse déjà vérifiée qui se redemande" $V77 \
  "  if u.adresse_verifiee_le is not null then perform socle.refus('ton adresse est déjà vérifiée'); end if;" "" \
  "$VA1"
prouver "le code d'une adresse que le compte n'a plus" $V77 \
  "     and lower(d.nouvelle) = lower(u.email);" ";" \
  "$VA2"
prouver "les erreurs de vérification jamais comptées" $V77 \
  "    update socle.changement_adresse set erreurs = erreurs + 1 where id = p_demande;" "" \
  "$VA2"
prouver "l'adresse vérifiée avec un code faux" $V77 \
  "  if c.code_empreinte <> p_empreinte then" "  if false then" \
  "$VA1"
prouver "l'adresse jamais dite vérifiée" $V77 \
  "  update socle.utilisateur set adresse_verifiee_le = coalesce(adresse_verifiee_le, p_maintenant) where id = socle.moi();" "" \
  "$VA1"
prouver "la vérification de l'adresse jamais tracée" $V77 \
  "  perform socle.tracer(null, 'compte.adresse.verifier', 'utilisateur', socle.moi(), null, jsonb_build_object('email', c.nouvelle));" "" \
  "$VA1"
prouver "des codes de vérification demandés sans limite" $V77 \
  "c.cree_le > p_maintenant - interval '1 hour') >= 3 then" "c.cree_le > p_maintenant - interval '1 hour') >= 300 then" \
  "$VA2"
prouver "la vérification demandée sans relais pour envoyer le code" $CO \
  "  if (!courriel) return { ok: false, motif: motif('connexion.oubli_indisponible') };" "" \
  "$VA1"
prouver "le code de vérification jamais envoyé" $CO \
  "  void courriel.envoi.envoyer({
    a: email, objet: rendre(t('connexion.courriel_objet'" "  void Promise.resolve({
    a: email, objet: rendre(t('connexion.courriel_objet'" \
  "$VA1"
prouver "« Vérifier mon adresse » absent de Ton compte" $CPTJS \
  "\${!c.adresseVerifiee && relais ? '<button type=\"button\" class=\"btn btn-primary\" id=\"cpt-verifier\">" "\${false ? '<button type=\"button\" class=\"btn btn-primary\" id=\"cpt-verifier\">" \
  "$VA3"
prouver "la carte qui promet la vérification à la prochaine connexion" $CPTJS \
  ": relais ? 'Un code part à cette adresse ; tapé ici, il prouve qu\'elle est bien à toi. C\'est elle qui te rend ton compte si tu oublies ton mot de passe.'" ": relais ? 'Elle se vérifie à ta prochaine connexion, par un code reçu à cette adresse.'" \
  "$VA3"
prouver "le code de vérification faux qui ne montre pas sa case" $CPTJS \
  "'/moi/adresse/verifier/confirmer', { demande, code: \$('#cpt-code-adresse').value }); } catch (x) { refuser(racine, x, { code: '#cpt-code-adresse' }); return; }" "'/moi/adresse/verifier/confirmer', { demande, code: \$('#cpt-code-adresse').value }); } catch (x) { refuser(racine, x); return; }" \
  "$VA3"
prouver "la carte pas redessinée après la vérification" $CPTJS \
  "          o.toast('Adresse vérifiée.');
          fini();" "          o.toast('Adresse vérifiée.');" \
  "$VA3"

# Les premiers pas refaits (lot onboarding, 09/10/2026 ; maquette validée par Skander) : leur calcul
# (plateforme/premiers-pas.js), ce qu'ils lisent sur le serveur (pont.js), leur panneau dans la v10 (web/v10/premiers-pas.txt).
PPJS=web/public/plateforme/premiers-pas.js
PPCSS=web/public/plateforme/premiers-pas.css
PP1="l'ordre de la maquette, ce que la porte et l'assistant ont fait, et le RIB qui suit, à faire maintenant"
PP2="un commerce encaisse sur place : pas de RIB réclamé"
PP3="le compte se dit tel qu'il est : l'adresse à vérifier seulement quand le serveur sait envoyer le code ; le code fait seulement s'il est actif"
PP4="ce qui manque à la fiche se nomme ; sans matricule, la facture n'est pas conforme"
PP5="l'activité laissée « Plus tard » se choisit ici ; qui facture sans devis a commencé aussi"
PP6="le comptable : fait dès que le mandat est proposé, et la proposition se dit"
PP7="le panneau quitte l'accueil quand le métier est fait : ni le code recommandé ni les facultatifs ne le retiennent ; jamais dans l'exemple"
PPW1="après la porte et l'assistant : le panneau de la maquette, la suite mise en avant, chaque bouton mène où il dit, et ce qui se fait ailleurs se coche au retour"
PPW2="une adresse que le serveur sait vérifier passe en tête ; une activité laissée de côté se choisit en revoyant l'assistant"
PPW3="au téléphone : le panneau ne déborde pas, et chaque bouton se touche du doigt"
prouver "le RIB réclamé à un commerce" $PPJS \
  "    if (C.ribAttendu(c)) {" "    if (true) {" \
  "$PP2"
prouver "un RIB faux compté comme fait" $PPJS \
  "const bon = !!rib && C.verifRib(rib).ok;" "const bon = !!rib;" \
  "$PP1"
prouver "une adresse à vérifier quand rien ne sait envoyer le code" $PPJS \
  "const aVerifier = !!(compte && compte.courriel && !compte.adresseVerifiee);" "const aVerifier = !!(compte && !compte.adresseVerifiee);" \
  "$PP3"
prouver "le code du téléphone compté fait sans être actif" $PPJS \
  "const code = !!(compte && compte.codeActif);" "const code = !!compte;" \
  "$PP1"
prouver "une fiche sans matricule comptée faite" $PPJS \
  "    if (!mf) manque.push('ton matricule fiscal');" "    if (!mf) void 0;" \
  "$PP4"
prouver "une fiche sans moyen de te joindre comptée faite" $PPJS \
  "    if (![c.address, c.phone, c.email].some((x) => txt(x))) manque.push(" "    if (false) manque.push(" \
  "$PP4"
prouver "le métier laissé « Plus tard » compté choisi" $PPJS \
  "const activite = !!c.setupDone && !!txt(c.activity);" "const activite = !!c.setupDone;" \
  "$PP5"
prouver "qui facture sans devis invité à faire son premier devis" $PPJS \
  "fait: unDevis || uneFacture," "fait: unDevis," \
  "$PP5"
prouver "le cabinet proposé compté comme à faire" $PPJS \
  "fait: mandat === 'actif' || mandat === 'propose'," "fait: mandat === 'actif'," \
  "$PP6"
prouver "la proposition au cabinet qui ne se dit pas" $PPJS \
  "attente: mandat === 'propose' ? 'Ta proposition attend que ton cabinet l\'accepte.' : ''" "attente: ''" \
  "$PP6"
prouver "le code recommandé qui retient le panneau sur l'accueil" $PPJS \
  "lesEtapes.some((x) => !x.fait && !x.facultatif && !x.recommande)" "lesEtapes.some((x) => !x.fait && !x.facultatif)" \
  "$PP7"
prouver "les premiers pas proposés dans l'exemple" $PPJS \
  "const demarrage = !exemple && " "const demarrage = " \
  "$PP7"
prouver "une suite proposée dans l'exemple" $PPJS \
  "const suivante = exemple ? null : " "const suivante = " \
  "$PP7"
prouver "le code du téléphone lu comme absent" web/public/plateforme/pont.js \
  "codeActif: !!moi.code_methode" "codeActif: false" \
  "$PPW1"
prouver "le cabinet choisi jamais lu" web/public/plateforme/pont.js \
  "mandat: m ? String(m.statut || '') : null" "mandat: null" \
  "$PPW1"
prouver "l'adresse à vérifier lue comme vérifiée" web/public/plateforme/pont.js \
  "adresseVerifiee: !!c.adresseVerifiee," "adresseVerifiee: true," \
  "$PPW2"
prouver "le relais d'e-mails du serveur jamais lu" web/public/plateforme/pont.js \
  "courriel: !!c.courriel," "courriel: false," \
  "$PPW2"
prouver "les premiers pas de la v10 sur la plateforme" $ASAPP \
  "  const lesPas = () => (window.SkanPremiersPas && bridge.etatDuDemarrage" "  const lesPas = () => (false" \
  "$PPW1"
prouver "l'accueil qui ne relit pas le serveur" $ASAPP \
  "    relireDemarrage();
    const p = lesPas();" "    const p = lesPas();" \
  "$PPW1"
prouver "l'accueil pas redessiné quand le serveur a changé" $ASAPP \
  "      if (change && data && location.hash === '#/dashboard') render(true);" "" \
  "$PPW1"
prouver "la suite des premiers pas pas dite « À faire maintenant »" $ASAPP \
  "\${!e.fait && (e.badge || encours) ? " "\${!e.fait && e.badge ? " \
  "$PPW1"
prouver "la bulle de la page posée sur les premiers pas" $ASAPP \
  "    if (\$('#view .pp-accueil, #view .premiers-pas')) return;" "    if (\$('#view .pp-accueil')) return;" \
  "$PPW1"
prouver "« Ajouter mon RIB » qui ne mène pas à sa case" $ASAPP \
  "    rib: ['Ajouter mon RIB', () => allerParametres('societe', 'p-banque:rib')]," "    rib: ['Ajouter mon RIB', () => allerParametres('societe', 'p-banque')]," \
  "$PPW1"
prouver "« Activer le code » qui ne mène pas à Ton compte" $ASAPP \
  "    code: ['Activer le code', () => allerParametres('compte', 'p-compte')]," "    code: ['Activer le code', () => allerParametres('societe')]," \
  "$PPW1"
prouver "« Inviter mon comptable » qui ne mène pas à l'onglet du cabinet" $ASAPP \
  "    mandat: ['Inviter mon comptable', () => { comptaState.tab = 'cabinet'; navigate('#/compta'); }]" "    mandat: ['Inviter mon comptable', () => navigate('#/compta')]" \
  "$PPW1"
prouver "« Vérifier mon adresse » qui ne mène pas à Ton compte" $ASAPP \
  "    adresse: ['Vérifier mon adresse', () => allerParametres('compte', 'p-compte')]," "    adresse: ['Vérifier mon adresse', () => allerParametres('societe')]," \
  "$PPW2"
prouver "« Choisir mon activité » qui écrit en route" $ASAPP \
  "    assistant: ['Choisir mon activité', () => runSetup(true)" "    assistant: ['Choisir mon activité', () => runSetup(false)" \
  "$PPW2"
prouver "au téléphone, les boutons d'une étape poussés à droite" $PPCSS \
  "gap: 8px; justify-content: flex-start; }" "gap: 8px; }" \
  "$PPW3"
prouver "au téléphone, le lien vers l'aide collé au bord du panneau" $PPCSS \
  "  .premiers-pas.pp2 > p { padding: 0 18px 18px; }" "  .premiers-pas.pp2 > p { padding: 0; }" \
  "$PPW3"
prouver "la proposition au cabinet cachée sous une étape faite" $ASAPP \
  "\${e.fait && e.attente ? \`<span class=\"pp-attente\">" "\${e.fait && e.attente ? \`<span class=\"small pp-attente\">" \
  "$PPW1"

# Le bilan : TOUJOURS les deux dernières lignes (tests/verif-preuves.sh le vérifie). Une preuve écrite
# après lui tourne, mais son échec ne ferait plus échouer le lot (défaut trouvé le 30/09/2026 : les
# preuves des briques 66 à 70 étaient après lui).
echo; echo "$ok preuves faites, $ko non prouvées${PARTIE:+ (groupe $PARTIE)}."
[ "$ko" -eq 0 ]
