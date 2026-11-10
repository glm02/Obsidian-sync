# Site Cordée

Site de présentation Next.js (App Router, TypeScript), Tailwind CSS v4 et composants shadcn/ui adaptés. Mesure d’audience par Vercel Web Analytics (sans cookie), chargée par un script et non par un paquet npm, et désactivée sur `/rejoindre` dont l’adresse porte l’invitation. Aucun autre traceur.

## Local

Node 22.18+ recommandé.

```sh
cd site
npm install
npm run dev
```

Ouvrir l’adresse locale affichée par Next.js.

```sh
npm run lint
npm run build
npm start -- -H 127.0.0.1 -p 3123
```

## Vercel

Importer le dépôt, choisir **Root Directory = site** et le preset **Next.js**. Garder les commandes par défaut : `npm install` puis `npm run build`. Aucune variable d’environnement n’est nécessaire au site.

Le serveur Cordée, SQLite et ses fichiers doivent être hébergés séparément sur un VPS. Configurer `CORDEE_PAGE_INVITATION=https://cordee.vercel.app/rejoindre` dans l’environnement du serveur, en adaptant l’adresse au déploiement Vercel.

Pages : `/` (présentation et rôles), `/deployer` (hébergement), `/guide` (parcours invité en quatre maquettes), `/rejoindre` (invitation locale au navigateur). Le logo est intégré par `src/components/logo.tsx` depuis `public/brand/cordee-logo.svg` ; le favicon est dans `src/app/icon.svg`. Les sources et variantes de la marque se trouvent dans `../brand/`.

## Invitations

Format : `https://cordee.vercel.app/rejoindre#serveur=https%3A%2F%2Fcordee.exemple.fr&code=ABCD-EFGH-JKLM`.

La page `/rejoindre` porte `noindex`. Seul le navigateur lit le fragment ; aucune requête ne transmet son contenu et aucun appel au serveur Cordée n’est effectué. Les valeurs sont affichées comme texte React et ne sont jamais interprétées comme HTML.

`site/.gitignore` exclut les dossiers `site/node_modules/`, `site/.next/`, les fichiers d’environnement et les résultats locaux de vérification. Licence du projet : MIT.
