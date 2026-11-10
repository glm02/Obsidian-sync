# Nouveautés

## 0.1.5

- **Un fichier qui ne peut pas être écrit ne bloque plus la synchronisation.** Avant, un seul changement impossible à appliquer (par exemple un dossier que l’ami avait renommé en changeant seulement les majuscules, sur Windows ou macOS) arrêtait tout : plus rien n’arrivait et plus rien n’était envoyé, avec le message trompeur « vérifie ta connexion ». Le fichier est maintenant mis de côté, réessayé à chaque synchro, et signalé par son nom ; le reste continue.
- Sur un disque qui ne distingue pas les majuscules, un dossier ou un fichier existant prend la casse du serveur au lieu d’échouer ou d’être écrasé.
- Le message d’erreur dit la vraie cause : « le serveur ne répond pas » seulement quand c’est le cas, sinon le détail du problème.
- Les dossiers, même vides, sont partagés entre les membres (le serveur doit être à jour ; un ancien serveur continue de synchroniser les notes).
- Comparaison d’une version avec la précédente et activité filtrable par membre (serveur à jour requis).

## 0.1.4

- Nom affiché modifiable dans Mon profil, sans changer sa photo ni perdre l’attribution de ses changements.
- Serveur et nom retenus sur cet appareil pour préparer les nouveaux coffres, sans transférer les accès au groupe.
- Un code d’invitation seul suffit lorsque le serveur est déjà connu ; une invitation complète peut choisir un autre serveur.
- Formulaire de connexion allégé, création d’un nouveau partage à la demande et nom du coffre proposé automatiquement.
- L’API de profil accepte les modifications partielles du nom et de la photo, avec validation avant écriture.

## 0.1.3

- Pause et reprise de la synchronisation automatique, avec conservation du choix entre deux lancements.
- Synchronisation manuelle ponctuelle possible pendant la pause ; une opération déjà en cours n’est pas interrompue.
- Panneau avec état actualisé, nombre de fichiers partagés et heure de la dernière synchronisation réussie.
- Messages d’erreur utiles : accès retiré, serveur indisponible, limite de tentatives ou fichier trop volumineux.
- Signalement des fichiers de plus de 50 Mo au lieu d’un saut silencieux.
- Membres et 40 derniers changements accessibles depuis le panneau, avec actualisation.
- Photo de profil avec aperçu et confirmation, recadrée et réencodée localement avant l’envoi ; retrait possible.
- Photos ou initiales dans les membres et l’activité, avec attribution des changements par identifiant d’auteur.
- Styles adaptés au thème d’Obsidian, distribués dans la release et dans l’archive ZIP.
- Protection du dossier de configuration personnalisé, à l’envoi comme à la réception.

## 0.1.2

- Installation avec BRAT et archive ZIP unique.
- Invitations ouvertes directement dans Obsidian, sans adhésion automatique.
- Choix des dossiers privés avant le premier envoi.
- Détection des changements distants via le transport réseau natif d’Obsidian.

## 0.1.1

- Logo dans la barre de gauche et panneau de partage accessible en un clic.
