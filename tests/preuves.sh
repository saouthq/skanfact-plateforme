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
  # Seul le fichier qui contient le test visé est rejoué (ses apostrophes y sont échappées) ;
  # s'il n'est pas trouvé, toute la suite.
  local cible; cible="$(python3 - "$copie/tests" "$attendu" <<'EOF'
import sys, pathlib
racine, titre = sys.argv[1], sys.argv[2]
for f in sorted(pathlib.Path(racine).rglob('*.test.ts')):
    texte = f.read_text(encoding='utf-8')
    if titre in texte or titre.replace("'", "\\'") in texte:
        print(f.relative_to(pathlib.Path(racine).parent)); break
EOF
)"
  # Les fichiers de travail de vitest restent dans la copie, effacée ensuite (sinon ils
  # s'entassent dans /tmp : environ 500 Ko par lancement).
  mkdir -p "$copie/.tmp"
  (cd "$copie" && TMPDIR="$copie/.tmp" npx vitest run ${cible:+"$cible"} --reporter=json --outputFile=resultat.json >/dev/null 2>&1)
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
  "if (!qui.codeAConfigurer && (await tx.query('select socle.code_manquant() m')).rows[0].m) qui.codeAConfigurer = true;" "" \
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

echo; echo "$ok preuves faites, $ko non prouvées."
[ "$ko" -eq 0 ]
