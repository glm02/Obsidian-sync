# Refonte UX de Cordée

Refonte locale uniquement dans `site/`, sans commit, push ni nouveau déploiement.

- Accueil condensé : titre court, démonstration interactive, trois promesses visuelles et détails repliables.
- Composants React réutilisables : Tabs, Accordion, Dialog, Card, navigation active, logos et démonstration.
- Démo : sélection des notes, simulation d’une modification, vues Fusion/Activité, exemple d’invitation dans une fenêtre accessible.
- Parcours invité/hébergeur regroupés dans des onglets ; guide invité condensé en quatre cartes avec maquettes.
- Logos GitHub, Obsidian, Docker et Vercel servis localement, avec attribution dans `THIRD_PARTY.md` ; aucun fournisseur de logos appelé par le navigateur.
- Logo Cordée existant conservé, navigation et pied de page harmonisés.

## Contrôles effectués sur cette refonte

| Vérification | Résultat |
| --- | --- |
| Installation des dépendances Radix | `npm install` : code 0 |
| Lint | `npm run lint` : code 0, aucun avertissement |
| Build et TypeScript | `npm run build` : code 0 |
| Invitations | `npm run test:invitation` : code 0, 2 tests réussis |
| Production | Démarrage avec `npx next start -H 127.0.0.1 -p 3123` |
| Routes | `/`, `/guide`, `/deployer`, `/rejoindre` : HTTP 200 |
| Responsive | Quatre pages contrôlées à 375 et 1280 px, aucun débordement horizontal |
| Captures | Huit captures du dernier build ouvertes et examinées |
| Démonstration | Simulation de modification, vues Fusion/Activité et navigation par flèche droite vérifiées |
| Fenêtre d’invitation | Ouverture et fermeture avec Échap vérifiées |
| Parcours | Onglet hébergeur et contenu associé vérifiés |
| FAQ | Ouverture d’une réponse vérifiée |
| Réduction des animations | Préférence émulée : transitions à 0 s et aucun contenu caché |
| Logos | Les SVG se décodent correctement ; les logos hors écran utilisent le chargement différé standard de Next Image |
| Confidentialité | Page d’invitation : noindex/nofollow, aucune ressource distante et aucun fetch/XHR/beacon observé au chargement |
| Console | Aucune erreur console observée pendant les interactions |
| Dépendances de production | `npm audit --omit=dev` : code 0, aucune vulnérabilité signalée |
| Diff | `git diff --check -- site` : code 0 |

Captures locales, ignorées par Git : `verification/refonte-accueil-375.png`, `verification/refonte-accueil-1280.png`, `verification/refonte-guide-375.png`, `verification/refonte-guide-1280.png`, `verification/refonte-deployer-375.png`, `verification/refonte-deployer-1280.png`, `verification/refonte-rejoindre-375.png`, `verification/refonte-rejoindre-1280.png`.

## Limites

Pas de nouveau déploiement Vercel, d’installation Obsidian réelle ni de test sur un téléphone physique. Le serveur VPS et l’extension n’ont pas été modifiés. L’audit npm complet conserve les huit alertes modérées déjà présentes dans les outils de développement ESLint/TypeScript/minimatch ; aucune alerte de production.