# Obsidian-sync (Cordée)

**Cordee** shares an Obsidian vault with friends using your own server. Install the beta with [BRAT](https://obsidian.md/plugins?id=obsidian42-brat), add `glm02/Obsidian-sync`, then open an invitation and choose a display name. The [official directory entry](https://community.obsidian.md/plugins/cordee) is published; version 0.1.2 was submitted for automated review on November 10, 2026. Use BRAT while in-app installation awaits approval.

**Privacy and network use:** the plugin contacts only the server you choose after you explicitly create or join a shared vault. Notes, attachments, file paths, display names and change history are sent to that server. The host can read them; there is no end-to-end encryption in version 0.1. Excluded folders and Obsidian settings are not shared. There is no client analytics, advertising, payment or external account requirement. Data outside the open vault is not accessed. Access tokens are stored locally in the plugin's `data.json`; keep `.obsidian/` out of public repositories. The server retains file versions until its operator removes them. See [the publication report](docs/publication.md) for tested platforms and current limits.

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

### Sans télécharger les fichiers un par un

La [fiche officielle de Cordee](https://community.obsidian.md/plugins/cordee) est publiée ; l’installation depuis le catalogue attend la validation de la revue automatique. En attendant :

1. Ouvre de préférence un coffre vide pour rejoindre tes amis.
2. Dans les modules complémentaires d’Obsidian, installe et active **BRAT**.
3. Dans BRAT, choisis **Add a beta plugin**, colle `glm02/Obsidian-sync`, puis confirme l’installation et active **Cordee**.
4. Rouvre ton invitation sur le site et clique sur **Ouvrir dans Obsidian**. Ajoute ton prénom et confirme **Rejoindre**.

BRAT installe les fichiers et gère les mises à jour. Le nom du catalogue est **Cordee** sans accent, conformément au format du catalogue ; l’interface conserve la marque Cordée.

### Installation manuelle de secours

Télécharge [cordee.zip](https://github.com/glm02/Obsidian-sync/releases/latest/download/cordee.zip), décompresse le dossier `cordee` dans `.obsidian/plugins/`, puis active Cordee. Tu peux aussi copier les fichiers :

1. Dans ton coffre, crée le dossier `.obsidian/plugins/cordee/`.
2. Copies-y `plugin/manifest.json` et `plugin/main.js`.
3. Obsidian → Réglages → Extensions communautaires → active **Cordee**.

Le logo Cordée apparaît dans la barre de gauche. Clique dessus pour ouvrir le panneau de partage, créer une invitation ou synchroniser. Le même panneau reste accessible dans les réglages et par la commande « Cordée : Ouvrir le panneau de partage ».

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

Pour préparer une release compatible Obsidian et BRAT : `python scripts/prepare_release.py`. Les fichiers sont produits dans `dist/<version>/`, ignoré par Git. Le manifeste à la racine et sa copie dans `plugin/` doivent rester identiques. Le tag GitHub doit correspondre exactement à leur version, sans préfixe `v`.

## Licence

MIT
