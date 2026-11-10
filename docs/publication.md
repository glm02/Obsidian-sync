# Publication de Cordee

## État au 10 novembre 2026

La [fiche publique officielle](https://community.obsidian.md/plugins/cordee) est publiée. La version 0.1.2, commit `f692cb2`, est soumise au contrôle automatique ; le dernier statut observé est **Pending**, avec le message « Your entry is live. An automated review is in progress. ». La fiche publique répond HTTP 200. Ceci ne signifie pas que l’installation depuis le catalogue est déjà approuvée. Le statut actuel se consulte dans le tableau de bord Obsidian Community.

## Candidat 0.1.2

- Identifiant : `cordee`.
- Nom du catalogue : `Cordee` (Basic Latin exigé par le catalogue). Marque et interface : Cordée.
- Dépôt public : `glm02/Obsidian-sync` ; licence MIT.
- Manifeste à la racine ; copie compatible avec l’installation locale dans `plugin/`.
- Release GitHub : tag `0.1.2`, pièces jointes `main.js`, `manifest.json`, `cordee.zip` et `SHA256SUMS.txt`.
- Aucune dépendance npm dans l’extension ; aucun module Node ou Electron à l’exécution.

## Installation avant admission

Installer BRAT depuis le catalogue Obsidian, puis lui ajouter `glm02/Obsidian-sync`. Le lien `obsidian://brat?plugin=glm02%2FObsidian-sync` ouvre sa confirmation d’installation. BRAT est un outil indépendant : Cordée ne s’installe ni ne se met à jour elle-même.

Une invitation peut ensuite ouvrir `obsidian://cordee?serveur=…&code=…`. Le formulaire est prérempli, mais aucune adhésion ni aucun envoi de notes ne se produit avant le clic explicite sur Rejoindre. Un lien ne remplace pas un coffre déjà connecté.

## Déclaration du réseau et des données

Le serveur est choisi par l’utilisateur ; aucun serveur personnel du développeur n’est imposé dans le code. Après consentement explicite, l’extension synchronise notes, pièces jointes et chemins des fichiers. Elle envoie le prénom choisi et reçoit les changements des membres. Les dossiers exclus et les réglages Obsidian restent locaux. Les changements distants sont vérifiés toutes les 2,5 secondes avec `requestUrl`, compatible avec le transport réseau d’Obsidian. Le serveur conserve l’historique et peut lire les notes : HTTPS est requis pour le déploiement public, sans chiffrement de bout en bout en v0.1. Aucun traçage, paiement, compte externe ou publicité côté extension.

## Contrôles et limites

Le panneau de partage de la version 0.1.1 a été ouvert et validé dans Obsidian Windows 1.15.0. Les tests automatisés du candidat couvrent le protocole d’invitation sans adhésion automatique, les liens invalides, les coffres isolés, la fusion, les suppressions, le garde-fou et la détection des changements distants. La préparation de release vérifie les manifests, la version et les fichiers distribués. Le site fait l’objet d’un lint, d’un build et d’une vérification mobile/ordinateur.

La compatibilité avec Android, iOS, macOS, Linux et les anciennes versions d’Obsidian n’a pas été validée sur appareils physiques. Le manifeste déclare une extension portable : seuls les API Obsidian et les API Web sont utilisés. Ces limites doivent être indiquées pendant la bêta ; elles ne constituent pas une certification de compatibilité.

## Soumission officielle

La procédure actuelle est [le site communautaire Obsidian](https://docs.obsidian.md/plugins/releasing/submit-plugin), pas une pull request à l’ancien registre. Se connecter avec le compte Obsidian, lier le compte GitHub propriétaire, puis ajouter le dépôt et traiter les résultats du contrôle automatique. L’installation directe depuis le catalogue dépend de cette validation. Aucun statut « publié » ou « approuvé » n’est revendiqué avant confirmation.

Texte de présentation proposé :

> Share an Obsidian vault with friends on your own server. Cordee syncs notes and attachments, merges text changes, and preserves conflicting versions. One person hosts the server; friends join with an invitation. No paid account or tracking. Version 0.1 is a beta: start with a separate vault and keep backups. Your server operator can read shared files; end-to-end encryption is not provided.
