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
  # SEULES=motif : ne rejouer que les preuves dont le nom y répond (pendant le travail ; avant un
  # envoi, toutes).
  if [ -n "${SEULES:-}" ] && ! [[ "$nom" =~ $SEULES ]]; then return 0; fi
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
  else echo "NON PROUVÉE   $nom → « $attendu » reste vert"; ko=$((ko+1)); fi
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
  "chaque table du socle a sa sécurité par ligne, forcée"
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
  "roles: { proprietaire: P } },
];" "roles: { proprietaire: P, administrateur: P } },
];" \
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
prouver "une invitation acceptée par une autre adresse" $E \
  "  if lower(v_email) <> i.email then" "  if false then" \
  "inviter, accepter"
prouver "une invitation expirée qui sert encore" $E \
  " or i.expire_le <= p_maintenant then" " then" \
  "une invitation expirée ne sert plus"
prouver "le propriétaire perd son rôle en acceptant une invitation" $E \
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
  "raison: p ? raison(p, requete.body) : motif('champ.valeur')" "raison: p ? p.message : motif('champ.valeur')" \
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

echo; echo "$ok preuves faites, $ko non prouvées."
[ "$ko" -eq 0 ]
