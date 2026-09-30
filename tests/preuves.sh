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
  "une session ouverte avant de devenir propriétaire"
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
prouver "une porte dérobée sans chemin fixé" $E \
  "language sql stable security definer set search_path = pg_catalog, socle as \$\$
  select coalesce((select u.code_methode" "language sql stable security definer as \$\$
  select coalesce((select u.code_methode" \
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
  "const remisable = lignes.filter((l) => !l.sansRemise)" "const remisable = lignes.filter(() => true)" \
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
  "            reponse.header('retry-after', String(v.attendreSecondes));" "" \
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
prouver "un bouton de l'entrée trop petit pour un doigt" web/src/plateforme.css \
  "  .btn, nav a, .sidebar-foot .foot-link, .dos-menu button, button.nav-group { min-height: 44px; }" "" \
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
prouver "une entreprise ouverte sans le code du téléphone que son rôle exige" "web/src/App.tsx|||$PONT" \
  "ecran = <Porte creee={(id) => { retenir(id); void charger(); }}|||    if (r.status === 403 && lu.bouton === 'compte.code.configurer') { location.replace('/'); throw new Error(lu.motif); }
    if (!r.ok) {" \
  "ecran = <Porte creee={ouvrirEntreprise}|||    if (!r.ok) {" \
  "$PA"
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
  "      ouvrirEntreprise(essai ? essai.id : (await appelCompte('POST', '/entreprises-essai')).id);
      return {};" "      return { motif: 'x' };" \
  "$VR"
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
  "  if (serveur !== demande.netAPayer) throw" "  if (Date.now() < 0) throw" \
  "l'émission : le numéro du serveur"
prouver "les lignes d'une facture émise encore modifiables" $DV \
  "'exchangeRate', 'lines', 'discountRate'" "'exchangeRate', 'discountRate'" \
  "une facture émise ne change plus ce qui a été scellé"
prouver "une facture émise refusée parce que la base a rangé ses clés autrement" $DV \
  "      if (canonique(avant?.[champ]) !== canonique(apres[champ])) throw" "      if (JSON.stringify(avant?.[champ]) !== JSON.stringify(apres[champ])) throw" \
  "une facture émise ne change plus ce qui a été scellé"
prouver "une facture émise qu'on peut effacer" $DV \
  "    if (!apres) throw new Refus(av ? 'v10.avoir_ne_s_efface_pas' : 'v10.emise_ne_s_efface_pas', numero);" "    if (!apres) return;" \
  "une facture émise ne change plus ce qui a été scellé"
prouver "un commercial qui ouvre tout le dossier" serveur/porte/gestes.ts \
  "  { code: 'socle.dossier.voir', module: 'socle', horsCle: true, ecrit: false,
    roles: { proprietaire: P, administrateur: P } }," "  { code: 'socle.dossier.voir', module: 'socle', horsCle: true, ecrit: false,
    roles: { proprietaire: P, administrateur: P, commercial: P } }," \
  "les droits : seuls ceux qui voient toute"

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
  "suite: lignes.length === n && dernier ? versCurseur(dernier.date_piece, dernier.id) : null," "suite: dernier ? versCurseur(dernier.date_piece, dernier.id) : null," \
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
  "'stampFee', 'creditOf', 'creditReason'];" "'stampFee', 'creditReason'];" \
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
        if (!(Number(v.amount) > 0)) return refus(\$('[name=amount]', root), 'Montant invalide.');
        if (bridge.emettre && (String(v.amount).split('.')[1] || '').length > C.decimalsFor(cur)) return refus(\$('[name=amount]', root), \`Un montant en \${cur} se compte à \${C.decimalsFor(cur)} décimales au plus.\`);
" "        const v = formValues(\$('#pf2', root));
        if (!(Number(v.amount) > 0)) return refus(\$('[name=amount]', root), 'Montant invalide.');
" \
  "$PX"
prouver "la caisse qui vend sans le serveur" $V10A \
  "        if (bridge.emettre) { toast('La caisse n\\'est pas encore dans la version en ligne de SkanFact : rien n\\'a été vendu.', true); return; }
" "" \
  "la caisse n'est pas encore en ligne"

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
  ".regex(/^[0-9]{7}[A-Z]\/?[A-Z]\/?[A-Z]\/?[0-9]{3}$/, { message: 'cabinet.champ.matricule' })" "" \
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
prouver "une balance Excel refusée" $PC \
  "      try { entrees = await dezipper(octets); } catch (e) {" "      try { entrees = null; } catch (e) {" \
  "$RP1"
prouver "un classeur dont une entrée gonfle sans limite" $PC \
  "  const MAX_ENTREE = 20 * 1024 * 1024;" "  const MAX_ENTREE = 2000 * 1024 * 1024;" \
  "$RP1"
prouver "un classeur qui gonfle sans limite au total" $PC \
  "  const MAX_CLASSEUR = 60 * 1024 * 1024;" "  const MAX_CLASSEUR = 6000 * 1024 * 1024;" \
  "$RP1"
prouver "le refus d'un classeur trop gros avalé" $PC \
  "if (e instanceof Error && e.message === TROP_GROS) throw e; " "" \
  "$RP1"
prouver "les feuilles d'un classeur lues sans être décompressées" $PC \
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
  "String(d.matricule || '').replace(/\\s+/g, '').replace(/[.-]/g, '/').toUpperCase()" "String(d.matricule || '').replace(/\\s+/g, '').toUpperCase()" \
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
  "[params.cabinet, dossier, corps.raisonSociale, corps.matriculeFiscal || null]" "[params.cabinet, dossier, corps.raisonSociale, corps.matriculeFiscal]" \
  "$NT1"
prouver "un dossier renommé sans trace" $CR \
  "      await tracer(tx, dossier, 'cabinet.dossier_tenu.renommer', dossier, avant," "      void (tx, dossier, 'cabinet.dossier_tenu.renommer', dossier, avant," \
  "$NT1"
prouver "le nom d'un dossier tenu que l'écran n'envoie pas" $PC \
  '        await appel('"'"'PUT'"'"', `/cabinets/${cabinetId}/dossiers/${id}`, { raisonSociale: nom, matriculeFiscal: matricule });' "" \
  "$NT2"
prouver "un matricule à points envoyé tel quel" $PC \
  "String(patch.matricule).replace(/\\s+/g, '').replace(/[.-]/g, '/').toUpperCase()" "String(patch.matricule).replace(/\\s+/g, '').toUpperCase()" \
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
  "    if (matricule && !MATRICULE.test(matricule)) nomme(" "    if (false) nomme(" \
  "$RP2"
prouver "un matricule en double dans le fichier qui passe l'essai" $CV \
  "    else if (matricule && matricules.has(matricule)) nomme(" "    else if (false) nomme(" \
  "$RP2"
prouver "un matricule à points de la v10 refusé" $CV \
  ".replace(/\\s+/g, '').replace(/[.-]/g, '/').toUpperCase();" ".replace(/\\s+/g, '').toUpperCase();" \
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
        const copie = await lireLaCopie();" "        throw e;
        const copie = await lireLaCopie();" \
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
  "      if (r.ok) await (await caches.open(CACHE)).put(cle, r.clone());
" "" \
  "$HL4"
prouver "sans réseau, les écrans gardés jamais servis" web/public/sw.js \
  "      const garde = (await caches.match(cle)) || (e.request.mode === 'navigate' ? await caches.match('/') : undefined);
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
        throw refusHorsLigne(e);" "        throw refusHorsLigne(e);" \
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
  "        const data = attente ? await rejouer(attente.contenu.data) : await relire();" "        const data = await relire();" \
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
prouver "retirer un appareil sans demander" $PONT \
  "        if (!bouton.dataset.confirme) {" "        if (false) {" \
  "$AW1"
prouver "retirer l'appareil où l'on est" $PONT \
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
  "      if (!(await remettre())) {" "      if (false) {" \
  "$AW2"
prouver "une remise ratée qui efface quand même" $PONT \
  "n\\'est effacé tant qu\\'il ne l\\'a pas reçu.');
        return;" "n\\'est effacé tant qu\\'il ne l\\'a pas reçu.');" \
  "$AW2"
prouver "un serveur qui trébuche pris pour une remise reçue" $PONT \
  "      return r.status < 500;" "      return true;" \
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
" "" \
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

# Le bilan : TOUJOURS les deux dernières lignes (tests/verif-preuves.sh le vérifie). Une preuve écrite
# après lui tourne, mais son échec ne ferait plus échouer le lot (défaut trouvé le 30/09/2026 : les
# preuves des briques 66 à 70 étaient après lui).
echo; echo "$ok preuves faites, $ko non prouvées${PARTIE:+ (groupe $PARTIE)}."
[ "$ko" -eq 0 ]
