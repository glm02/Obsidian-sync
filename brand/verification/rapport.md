# Livraison du logo Cordée

## Piste retenue

Le **C d’attache** réunit une initiale immédiatement identifiable et deux boucles égales, reliées par un même corps.
Ce lien évoque un petit groupe qui avance ensemble ; le dessin reste accueillant, ouvert et reproductible dans une seule couleur.
Il est retenu face au fil sinueux, plus proche d’un itinéraire, et aux deux replis, plus proches d’un maillon générique.

## Fichiers livrés

Les dix fichiers demandés sont présents à la racine de `brand/` :

1. `cordee-marque.svg` — symbole carré, une seule couleur `#4124fb`.
2. `cordee-logo.svg` — horizontal, accent et texte clair, fond transparent.
3. `cordee-logo-clair.svg` — horizontal, accent et texte sombre, fond transparent.
4. `cordee-monochrome.svg` — une couleur `currentColor`, noir par défaut.
5. `favicon.svg` — symbole blanc sur fond `#161616`, coins arrondis.
6. `icone-512.png` — même icône, exactement 512 × 512 px.
7. `favicon-32.png` — exactement 32 × 32 px.
8. `favicon-16.png` — exactement 16 × 16 px.
9. `apercu.html` — planche d’essai locale sans dépendance ni appel réseau.
10. `README.md` — concept en cinq lignes, couleurs, construction, espace libre, interdits et usages.

Compléments : `construire.py`, `verifier.py`, les recherches dans `explorations/`, et les preuves dans `verification/`. Les trois pistes sont visibles en bas de la planche ; `explorations/pistes-v1.png` conserve le premier passage. Le premier passage a été suivi d’un affinage du centrage et des deux ouvertures, puis d’une deuxième vérification du dessin retenu.

## Contrôles réellement faits

| Contrôle | Résultat observé |
| --- | --- |
| Lecture du contexte | `README.md` et `docs/conception.md` lus avant le dessin |
| Références | Bibliothèque du skill interrogée et cinq constructions étudiées, sans copie de tracé |
| Audit des trois pistes | Scores indicatifs 99, 98 et 100 ; trait restant dans B, réservé à l’exploration |
| Audit des cinq SVG finaux | 99 pour le symbole, 100 pour les trois logos, 99 pour la tuile ; aucune erreur bloquante |
| Structure des SVG | Pas de texte vivant, police, image embarquée, gradient, filtre, masque, clip ou contour à convertir |
| Symbole | Un seul tracé fermé avec deux vrais évidements ; intersections de cercles calculées |
| Logo | Sept tracés de lettres/accent, en plus du symbole ; aucun fichier de police |
| 16 px | PNG réel regardé à sa taille et agrandi sans lissage ; C reconnaissable, deux ouvertures présentes |
| 32 px | PNG réel regardé ; anneaux et ouverture centrale distincts |
| Contrôle des ouvertures du PNG | Deux composantes sombres fermées : 1 pixel chacune à 16 px, puis 5 et 6 pixels à 32 px, seuil de luminance 120 |
| Détail minimal à 32 px | Anneaux de 18 unités : 2,25 px dans le symbole, environ 1,89 px dans l’icône avec sa marge |
| Monochrome | Noir sur clair et blanc sur sombre regardés dans la planche |
| Inversé | Blanc sur bleu et blanc sur sombre regardés ; aucun évidement bouché |
| Rendu grand format | Logo horizontal en 1016 × 256 et icône 512 × 512 regardés |
| Équilibre et silhouette | Miroir, rotation 180°, flou 1 et 2 px regardés avec la planche du skill ; pas de lecture indésirable relevée lors de cet examen |
| Comparaison de métier | Symbole regardé à hauteur égale auprès de quatre marques de la bibliothèque ; comparaison temporaire non incluse dans la livraison |
| Navigateur headless | Chrome 157.0.8103.40, ouverture de `apercu.html` localement, captures réelles |
| Bureau et mobile | Largeurs 1440 et 390 px ; pas de débordement horizontal ; toutes les images chargées |
| Dimensions CSS | Les symboles annoncés à 16, 24, 32, 48 et 64 px mesurent bien ces dimensions |
| Réseau et JavaScript | Aucun appel réseau, aucune erreur de page |
| PNG | Dimensions exactes, fond central `#161616`, coins transparents ; alpha résiduel de 1/255 au coin du 16 px dû à l’anticrénelage de Chrome |

Les scores du skill sont des heuristiques, pas des certifications. L’information de centrage du symbole est intentionnelle : sa boîte peinte est déplacée de 4,4 unités vers la droite pour compenser l’ouverture du C. L’information de tuile dans le favicon est attendue ; le symbole sans fond est fourni séparément.

Le contraste calculé du blanc `#f9fbff` sur `#161616` est de **17,47:1**, contre **2,47:1** pour le bleu sur ce même fond. C’est la raison du blanc dans les favicons. Les logos principaux conservent l’accent demandé dans leur symbole de grande taille.

## Preuves consultables

- `apercu-bureau.png` : capture complète de la planche, largeur 1440 px.
- `apercu-mobile.png` : capture complète, largeur 390 px.
- `tests-fonds-tailles.png` : cadrage des traitements et tailles réelles.
- `pixels.png` : les PNG 16 et 32 px agrandis dix fois sans interpolation.
- `logo-sombre.png` : premier rendu grand format du logo final.
- `audit-svg.json` : résultats du script `svg_audit.py` du skill.
- `controles.json` : contrôles XML, PNG et navigateur exécutés par `verifier.py`.

Les captures et les agrandissements ci-dessus ont été ouverts et regardés, y compris le rendu mobile. La comparaison contenant les marques de référence a également été regardée, puis retirée des fichiers livrés.

## Non vérifié

L’intégration réelle dans Obsidian, dans le site et dans les navigateurs autres que Chrome n’a pas été testée. Aucun essai sur appareil physique, impression, conversion CMJN ou fabrication n’a été effectué. Il n’y a eu ni test auprès d’utilisateurs, ni recherche juridique exhaustive d’antériorité du nom ou du dessin.

Tout le travail de cette mission est contenu dans `brand/`. Aucun commit, push ou changement dans `site/`, `plugin/`, `server/` ou `deploy/` n’a été effectué.
