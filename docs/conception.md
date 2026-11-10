# Conception de Cordée

## L'idée

Partager un coffre Obsidian entre amis (révisions, projet de groupe, notes de cours) sans payer d'abonnement et sans confier ses notes à une entreprise. Une personne héberge un petit serveur ; les autres installent l'extension et collent un lien d'invitation.

Objectif d'usage : **aucune commande à taper, ça marche sur téléphone, on ne perd jamais une ligne**.

## Pourquoi pas Git ?

`obsidian-sync-facile` (Git + GitHub) marche, mais :
- il faut un compte GitHub, Git installé et un double-clic sur `SYNC.bat` ;
- il ne marche pas sur téléphone ;
- les changements des autres n'arrivent que quand chacun pense à synchroniser.

Cordée garde les bonnes idées (fusion des notes ligne à ligne, copie de conflit pour les fichiers binaires, garde-fou contre les suppressions massives) et enlève ces trois freins.

## Fonctionnalités

### Version 0.1 (ce dépôt)

| Fonction | Détail |
|---|---|
| Serveur auto-hébergé | Un seul processus Node 22, aucune dépendance, une base SQLite et un dossier de fichiers. Image Docker et Caddy pour le HTTPS. |
| Coffres multiples | Un serveur héberge autant de coffres que voulu. Créer un coffre demande le code de création de l'hébergeur. |
| Invitations | Lien `https://serveur/rejoindre/ABCD-EFGH-JKLM`, valable 7 jours, 5 personnes. Code lisible, sans 0/O ni 1/I. |
| Synchro automatique | À chaque modification (après 2 s de calme), à l'ouverture, et toutes les 5 min par sécurité. |
| Pause/reprise | Les automatismes peuvent être suspendus, avec conservation du choix. La synchronisation manuelle reste disponible. |
| État de la synchro | Dernière synchronisation réussie, fichiers partagés et erreurs utiles dans le panneau. |
| Temps quasi réel | L’extension vérifie les révisions distantes toutes les 2,5 s via `requestUrl` ; le serveur propose aussi un flux d’événements. |
| Fusion des notes | `.md`, `.txt`, `.csv` modifiés des deux côtés : fusion à trois versions, ligne à ligne. Même ligne modifiée différemment : les deux versions sont gardées à la suite, avec une notification. |
| Fichiers binaires | Image ou PDF modifié des deux côtés : la version de l'autre prend la place, la tienne est gardée en « (conflit Prénom date) ». |
| Suppressions | Un fichier supprimé par un ami part dans la corbeille locale du coffre (`.trash`), donc récupérable. |
| Garde-fou | Si plus de la moitié du coffre (et plus de 20 fichiers) disparaît d'un coup, rien n'est supprimé sur le serveur. |
| Activité | Membres et 40 derniers changements, depuis le panneau ou la palette de commandes. |
| Photos de profil | Photo choisie et confirmée par la personne, visible par les membres du même groupe. Les changements sont associés à l’identifiant de leur auteur. |
| Dossiers privés | Réglage « Dossiers non partagés ». Le dossier de configuration indiqué par `Vault.configDir` n’est jamais partagé. |
| Historique | Le serveur garde toutes les versions. La restauration depuis l'extension viendra en 0.2. |
| Mobile | L'extension utilise les API Obsidian et Web, sans module Node/Electron. Les appareils Android et iOS physiques restent à valider. |

### Feuille de route

- **0.2** : restaurer une version d'une note depuis l'historique, page web d'administration (membres, invitations, place utilisée), retirer un membre.
- **0.3** : édition à plusieurs en direct dans la même note (Yjs), curseurs des autres.
- **0.4** : chiffrement de bout en bout optionnel (le serveur ne voit que des données chiffrées ; la fusion se fait déjà côté extension, ce qui le rend possible).
- **Publication** : dépôt dans le catalogue des extensions communautaires d'Obsidian.

## Stack

| Partie | Choix | Pourquoi |
|---|---|---|
| Serveur | Node 22, TypeScript exécuté directement (`node src/main.ts`) | Pas de compilation, pas de `node_modules` : rien à mettre à jour côté sécurité, et un serveur qui tient en un fichier lisible. |
| Base | SQLite intégré à Node (`node:sqlite`) | Un fichier, sauvegarde par simple copie, largement suffisant pour des groupes d'amis. |
| Contenus | Fichiers sur disque nommés par leur SHA-256, un dossier par coffre | Dédoublonnage gratuit, vérification d'intégrité à l'envoi, historique sans surcoût. |
| Temps réel | Flux d'événements (Server-Sent Events) | Plus simple que WebSocket, traverse les proxys, aucune dépendance. |
| HTTPS | Caddy dans `docker-compose.yml` | Certificat Let's Encrypt automatique. |
| Extension | Un seul `main.js` en JavaScript, sans compilation | Vérifiable par tous avant installation. Un passage en TypeScript + esbuild est prévu au moment de la publication. |
| Tests | `node:test` | Inclus dans Node. Le test de bout en bout fait tourner le vrai moteur de l'extension contre un vrai serveur. |

## Protocole

- Chaque coffre a un numéro de révision qui augmente à chaque changement.
- Le client retient la dernière révision vue et, pour chaque fichier, l'empreinte de la dernière version commune (la base).
- **Récupérer** : `GET /changements?depuis=N`, puis pour chaque fichier : rien changé ici, on prend la version distante ; changé des deux côtés, on fusionne.
- **Envoyer** : `PUT /blobs/<sha256>` puis `POST /fichiers {chemin, hash, base}`. Le serveur refuse (409) si la base ne correspond plus à sa version actuelle : le client récupère, fusionne et renvoie.
- Le serveur ne fusionne jamais : il compare et enregistre. Toute l'intelligence est dans l'extension, ce qui prépare le chiffrement de bout en bout.

## Sécurité

- Jetons aléatoires de 256 bits, stockés hachés. Codes d'invitation et de création hachés.
- Un jeton ne donne accès qu'à son coffre ; les contenus sont rangés par coffre.
- Chemins vérifiés (`..`, chemins absolus, antislash refusés), empreinte vérifiée à chaque envoi, taille maximale configurable.
- Routes à code limitées à 10 essais par minute et par adresse.
- Le code de création n'est jamais écrit dans les journaux.

## Droit

- Un coffre est un dossier de fichiers Markdown ; le synchroniser est libre.
- Règles des extensions Obsidian à respecter pour la publication : pas « Obsidian » dans le nom ni l'identifiant, usage du réseau annoncé dans la description, pas de télémétrie, pas de code masqué. À relire sur le site d'Obsidian avant de soumettre.
- RGPD : chaque hébergeur est responsable de son serveur. Cordée ne collecte rien.
