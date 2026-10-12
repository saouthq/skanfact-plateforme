# SkanFact — la fiche des testeurs

*Pour les premières personnes qui essaient SkanFact (le serveur d'essai, à partir d'octobre 2026). Écrite pour être lue
telle quelle, ou recopiée dans un message WhatsApp.*

## Ce que tu vas essayer

SkanFact, c'est la gestion d'une entreprise tunisienne au même endroit : devis, factures, clients, stock, caisse,
achats, paie et comptabilité, avec le cabinet comptable qui travaille dans les mêmes données.

Tu l'utilises **dans ton navigateur**, à l'adresse **https://app.skanfact.tn**, sur ton ordinateur ou ton téléphone.
Rien à installer.

## Une règle, une seule

**Ce serveur est un serveur d'essai : n'y mets que des données inventées.** Pas le vrai nom de tes clients, pas leurs
vrais matricules, pas tes vrais chiffres. Invente une boulangerie, une quincaillerie, un cabinet : c'est fait pour ça.
Les vraies données viendront plus tard, sur les serveurs en Tunisie.

**Une seule exception : ton adresse e-mail doit être la tienne**, une adresse que tu lis. SkanFact y envoie un code à six
chiffres pour vérifier ton compte (et pour « mot de passe oublié ») : avec une adresse inventée, tu restes bloqué à
l'inscription. Pour faire plusieurs comptes avec une seule adresse Gmail, ajoute `+` et un mot avant le `@` :
`prenom+essai1@gmail.com` arrive dans la même boîte.

## Commencer (5 minutes)

1. Ouvre **https://app.skanfact.tn** et clique sur **« Créer mon compte »**.
2. Donne ton nom, ton adresse e-mail (la vraie, voir plus haut) et un mot de passe (au moins 10 caractères).
3. **« Vérifie ton e-mail »** : tape le code à six chiffres que tu viens de recevoir (regarde aussi dans les indésirables).
4. Choisis :
   - **« Découvrir avec une entreprise d'essai »** : une entreprise d'exemple déjà remplie (cinq ans d'activité) et une
     visite guidée, pour tout essayer tout de suite ;
   - ou **« Commencer avec mon entreprise »** : ta propre entreprise de test, vide, que tu remplis toi-même (un nom
     inventé suffit) ; tu peux faire l'une puis l'autre ;
   - ou **« Je suis un cabinet comptable »**.

C'est tout : tu es dans SkanFact. Mot de passe oublié ? Clique **« Mot de passe oublié ? »** sur l'écran de connexion :
un code arrive à ton adresse.

**Ton code de connexion** : quand tu te connectes depuis un appareil que SkanFact ne connaît pas, un code à 6 chiffres
arrive **par e-mail**. C'est le réglage de départ, pour tout le monde (un cabinet comptable aussi) : rien à installer. Tu
peux préférer, dans Paramètres → **Ton compte** → « Ton code de connexion » :
- **une application d'authentification** gratuite (**Google Authenticator** ou **Microsoft Authenticator**) : scanne le
  code QR affiché, **garde les codes de secours** (une photo suffit : chacun remplace une fois le code si tu perds ton
  téléphone), puis tape le code à 6 chiffres ;
- **un SMS** sur ton mobile tunisien, dès que le serveur d'essai envoie des SMS (le choix le dit tant qu'il ne le fait
  pas).

## Quoi essayer

Fais ce que tu ferais dans ta vraie journée. Quelques idées :

- **Vendre** : créer un client, faire un devis, le transformer en facture, l'émettre, enregistrer le paiement, relancer
  une facture impayée, faire un avoir.
- **La caisse** : ouvrir la caisse, vendre quelques articles, encaisser en espèces, fermer la journée (le « Z »).
- **Acheter** : un fournisseur, une commande, la réception, la facture d'achat, le règlement.
- **Le stock** : des articles, leurs prix, ce qui reste en stock.
- **L'équipe** : Paramètres → **L'équipe** → « Inviter quelqu'un… », son adresse e-mail et ses rôles ; envoie-lui le
  lien (copier, WhatsApp ou ta messagerie). Il crée son compte **avec cette adresse-là** et arrive dans ton entreprise,
  avec ce que ses rôles lui ouvrent. Change ses rôles, retire-le, essaie avec un deuxième navigateur.
- **Tes données** : Paramètres → Données et sécurité → **« Télécharger toutes les données »** : un seul fichier avec tout
  ce que ton entreprise a sur SkanFact.
- **Le cabinet comptable** : relier un client, voir ses écritures, préparer la déclaration du mois.
- **Sur ton téléphone** : les mêmes écrans, en petit.

## Ce qui ne marche pas encore (c'est normal)

- **El Fatoora (la facture électronique), la signature DigiGo et le paiement en ligne Konnect** : la facture se
  prépare, mais rien ne part à la TTN ni à la banque. Les accès de test sont en cours de demande.
- **Les SMS** : le fournisseur est choisi (WinSMS), pas encore branché sur le serveur d'essai : rien n'est envoyé par
  SMS pour l'instant. Les e-mails, eux, partent (le code de connexion, le mot de passe oublié, l'alerte des messages du
  cabinet) ; l'invitation d'un collègue, non : c'est toi qui lui envoies le lien.

## Tu vois un problème ? Dis-le, même petit

Envoie un message dans le groupe WhatsApp des testeurs, avec :

1. **une capture d'écran** ;
2. **ce que tu voulais faire** (« je voulais enregistrer le paiement de la facture FAC-2026-003 ») ;
3. **ce qui s'est passé** (« le bouton ne fait rien », « je ne comprends pas ce mot », « le total est faux »).

Tout compte : un bouton qu'on ne trouve pas, un mot qu'on ne comprend pas, un chiffre qui semble faux, une page lente.
C'est exactement ce qu'on cherche. SkanFact se met à jour tout seul, souvent plusieurs fois par jour : ce que tu
signales est souvent corrigé le jour même.

Merci de nous aider à construire SkanFact.
