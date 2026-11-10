# Cordée

Le « C d’attache » est une initiale continue, terminée par deux boucles égales.  
Les boucles évoquent les personnes qui choisissent de se relier.  
Le corps commun figure ce qu’elles construisent et partagent ensemble.  
L’ouverture du C garde une impression d’accueil, sans enfermer le groupe.  
Le mot « Cordée » est dessiné sur mesure, accent compris, entièrement en tracés.

## Fichiers

| Fichier | Usage |
| --- | --- |
| `cordee-marque.svg` | Symbole seul, accent bleu, viewBox 256 × 256 |
| `cordee-logo.svg` | Logo horizontal pour fond sombre, viewBox 1016 × 256 |
| `cordee-logo-clair.svg` | Logo horizontal pour fond clair |
| `cordee-monochrome.svg` | Logo en une couleur, `currentColor`, noir par défaut |
| `favicon.svg` | Symbole blanc sur tuile sombre arrondie |
| `icone-512.png` | Même icône, 512 × 512, coins transparents |
| `favicon-32.png`, `favicon-16.png` | Rendus directs aux dimensions indiquées |
| `apercu.html` | Planche locale : fonds, tailles réelles, pixels, concepts |
| `explorations/` | Trois pistes, première version conservée, choix argumenté |
| `verification/` | Captures de navigateur et résultats des contrôles |
| `construire.py`, `verifier.py` | Construction et vérification reproductibles |

## Couleurs

| Rôle | HEX | RVB |
| --- | --- | --- |
| Accent unique | `#4124fb` | 65, 36, 251 |
| Fond sombre et texte sur clair | `#161616` | 22, 22, 22 |
| Texte sur sombre et inversé | `#f9fbff` | 249, 251, 255 |

Les petites icônes utilisent le blanc sur fond sombre pour garder leurs ouvertures lisibles. Le bleu est réservé au symbole du logo principal et aux fonds d’accent. Les SVG de logo ont un fond transparent ; l’icône possède son propre fond. Le fichier monochrome hérite de `currentColor` lorsqu’il est inséré comme SVG dans le HTML ; utilisé avec une balise `img`, il est noir par défaut.

## Construction et espace libre

Le symbole utilise des arcs de cercle : rayons extérieur 104, intérieur 68, boucles de rayon 32, évidements de rayon 14. L’épaisseur du C est de **36 unités** dans le viewBox 256. Les raccords aux boucles sont les intersections calculées des cercles ; le dessin final ne contient ni trait à épaissir ni masque. Le décalage horizontal de 4,4 unités par rapport au centrage de la boîte visible compense optiquement l’ouverture du C.

La zone de protection vaut **une épaisseur du C**, soit 36 unités ou environ 14 % de la hauteur du viewBox. La mesurer depuis le dessin visible, autour du symbole comme autour du logo complet ; les marges internes du SVG ne constituent pas toute la zone de protection. Garder le symbole à **16 px minimum**, et le logo horizontal à **160 px de large minimum**. Les icônes utilisent le symbole à 84 % dans une tuile de rayon 56 sur 256.

## À éviter

- Ne pas étirer, incliner, tourner ou modifier l’écart entre les deux boucles.
- Ne pas boucher les évidements, ajouter de contour, d’ombre ou de dégradé.
- Ne pas remplacer le lettrage ni supprimer l’accent de « Cordée ».
- Ne pas employer le bleu pour les favicons sur fond sombre ; prendre les icônes blanches fournies.
- Ne pas placer directement le dessin sur une photo chargée ; conserver un fond uni et l’espace libre.

## Vérification et reproduction

Ouvrir `apercu.html` dans un navigateur. Les contrôles réellement exécutés et leurs limites figurent dans [le rapport](verification/rapport.md). Les recherches et le choix sont documentés dans [la note de conception](explorations/recherche.md). Le symbole et les lettres sont originaux, sans police intégrée ni ressource externe.

`python brand/construire.py` reconstruit les SVG et la planche. Les PNG ont été rendus avec `render_png.py` du skill logo-design, directement en 512, 32 et 16 px, puis contrôlés avec `python brand/verifier.py`. Ce dernier utilise Pillow et Playwright avec Chrome local. Aucun commit ni publication n’est nécessaire pour consulter cette livraison.
