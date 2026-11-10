# Obsidian-sync (Cordée)

Partage un coffre Obsidian avec tes amis, sur ton propre serveur. Gratuit, auto-hébergé, sans compte GitHub, et ça marche sur téléphone.

- Les modifications arrivent chez les autres en quelques secondes.
- Une note modifiée par deux personnes est fusionnée ligne à ligne ; rien n'est perdu.
- Une invitation, c'est un lien à coller dans l'extension.

Détails des choix : [docs/conception.md](docs/conception.md).

> État : version 0.1, en test. Fais une copie de ton coffre avant de l'essayer.

## Héberger le serveur

### Sur un VPS avec Docker (HTTPS automatique)

1. Fais pointer un nom de domaine vers le VPS, par exemple `cordee.exemple.fr`.
2. Copie ce dépôt sur le VPS, puis :

```sh
cp .env.exemple .env      # mets ton domaine dans CORDEE_DOMAINE
docker compose up -d
docker compose exec cordee cat /donnees/code-creation.txt   # le code pour créer des coffres
```

Caddy obtient le certificat HTTPS tout seul. Les données sont dans le volume `cordee-donnees` : pour sauvegarder, copie-le.

### Sur un VPS qui a déjà Caddy ou nginx

Les ports 80/443 sont déjà pris : on lance Cordée seul, sur `127.0.0.1:8800`, et le proxy existant le publie.

```sh
CORDEE_DOMAINE=cordee.exemple.fr docker compose -f deploy/compose-proxy-existant.yml up -d --build
```

Bloc Caddy prêt à adapter : [deploy/cordee.caddy](deploy/cordee.caddy). Le proxy doit **écraser** l'en-tête `X-Real-IP` (`CORDEE_DERRIERE_PROXY=1`), sinon le limiteur d'essais est commun à tous les visiteurs.

### Sans Docker

Node 22.18 ou plus récent, aucune installation de paquet :

```sh
cd server
CORDEE_URL_PUBLIQUE=https://cordee.exemple.fr npm start
```

| Variable | Rôle | Par défaut |
|---|---|---|
| `CORDEE_PORT` | Port d'écoute | `8787` |
| `CORDEE_DONNEES` | Dossier des données | `./donnees` |
| `CORDEE_CODE_CREATION` | Code pour créer un coffre | généré dans `code-creation.txt` |
| `CORDEE_URL_PUBLIQUE` | Adresse publique, pour fabriquer les liens d'invitation | aucune |
| `CORDEE_TAILLE_MAX_MO` | Taille maximale d'un fichier | `50` |
| `CORDEE_DERRIERE_PROXY` | `1` : lire l'adresse du visiteur dans `X-Real-IP` (posé par le proxy) | désactivé |
| `CORDEE_PAGE_INVITATION` | Page d'invitation hébergée ailleurs (ex. `https://cordee.vercel.app/rejoindre`) : le lien devient `<page>#serveur=…&code=…`, le code ne quitte jamais le navigateur | aucune (lien vers le serveur) |

Mets toujours le serveur derrière HTTPS : les jetons passent dans les en-têtes.

## Installer l'extension

En attendant sa publication dans le catalogue d'Obsidian :

1. Dans ton coffre, crée le dossier `.obsidian/plugins/cordee/`.
2. Copies-y `plugin/manifest.json` et `plugin/main.js`.
3. Obsidian → Réglages → Extensions communautaires → active **Cordée**.

Ensuite, dans les réglages de Cordée :
- **Pour créer un coffre partagé** : adresse du serveur, nom du coffre, ton prénom et le code de création. Tout le coffre est envoyé.
- **Pour rejoindre** : colle le lien d'invitation et ton prénom. Le mieux est de partir d'un coffre vide.

Commandes : « Synchroniser maintenant », « Créer une invitation pour un ami », « Voir qui a modifié quoi ».

## Développer

```sh
cd server
npm test
```

Les tests couvrent l'API, la fusion des notes et une synchro de bout en bout entre deux coffres simulés.

## Licence

MIT
