# Recherche de symbole

## Brief

Cordée est un serveur auto-hébergé et une extension pour partager un coffre de notes entre amis. Une personne héberge, les autres rejoignent avec une invitation ; les notes restent portables et le groupe avance ensemble. Le signe doit être convivial, clair, collectif et sobre, sans raconter toute l’architecture technique. Il doit fonctionner sur le site sombre, en favicon et dans l’extension.

Contraintes : une couleur pour le symbole, aucune dépendance à un effet, lisibilité à 16 px, accent unique `#4124fb`, fond `#161616`, texte `#f9fbff`. Écarter nuage, cadenas, flèches de synchronisation, cristal et silhouette proche du logo d’Obsidian. Le brief demande une sélection autonome et le kit complet : la sélection ci-dessous constitue la décision de cette livraison.

## Recherche et carte de mots

La bibliothèque du skill logo-design a été interrogée avec `developer-tools`, `rope`, `loop`, `letterform`, `circle` et `line-monoline`. Le panorama développeur montre de nombreux cercles, monolignes, symboles abstraits et dégradés. Les marques de référence étudiées pour leurs méthodes de construction sont Squarespace (maillons), Airbnb (boucle), Mailgun (cercle et contreforme), Pagekit (continuité et interruption), Socket.IO (silhouette et monochrome). Aucun contour ni tracé de ces marques n’est repris dans les fichiers livrés.

Carte : cordée → corde, attache, deux personnes, relais ; notes → lignes, marge, page ; promesse → confiance, autonomie, continuité ; ton → rond, accueillant, simple. L’intersection retenue est « une initiale dans laquelle deux attaches sont égales ».

## Neuf idées initiales

1. **Le C d’attache, lettre-symbole** : les deux extrémités d’un C deviennent des boucles égales.
2. **Le fil commun, abstrait** : trois points appartiennent à un même fil sinueux.
3. **Les deux replis, abstrait** : deux bandes se replient autour d’une attache partagée.
4. **Le cercle noué, pictogramme** : une boucle est fermée par un petit nœud, trop chargé à 16 px.
5. **Le C tendu, lettre-symbole** : une corde diagonale traverse une initiale, lecture trop proche d’un signe barré.
6. **La marge commune, abstrait** : deux lignes de notes partagent une marge, trop proche d’une icône de document.
7. **Le relais, abstrait** : des points progressent sur une pente, lecture d’itinéraire trop forte.
8. **La ligature, mot-symbole** : une connexion entre les lettres relie le nom, peu adaptée à un favicon autonome.
9. **Le duo de pages, pictogramme** : deux feuillets partagent un bord, silhouette trop générique de livre.

Les trois premières ont été construites en noir, comparées et auditées. La planche `pistes-v1.png` conserve le premier passage, avant correction du centrage.

## Comparaison des trois pistes construites

Notes de conception indicatives, sur 5 ; elles ne constituent pas une mesure utilisateur.

| Piste | Idée claire | Distinction | Simplicité | Pertinence | Petit format |
| --- | --- | --- | --- | --- | --- |
| A · C d’attache | 5 | 4 | 5 | 5 | 4 |
| B · Fil commun | 4 | 3 | 4 | 4 | 3 |
| C · Deux replis | 4 | 3 | 4 | 4 | 4 |

**A retenue** : le C rattache le signe au nom, et ses deux boucles donnent au lien collectif un détail mémorisable. La silhouette est continue et se reproduit dans un seul aplat. Le risque de lecture « connecteur » reste possible ; le nom et les contextes amicaux installent le sens de cordée.

**B écartée** : les points parlent de partage, mais le fil devient un S ou une route en petit. **C écartée** : l’attache est nette, mais le maillon est un motif déjà fréquent et son chevauchement alourdit le centre.

## Affinage de A

Premier passage : dessin en arcs, évidements de rayon 12 et placement décalé vers la gauche. Deuxième passage : déplacement de 22 unités vers la droite, laissant le centre de la boîte peinte 4,4 unités à droite du centre du viewBox pour compenser son ouverture ; évidements agrandis à 14 pour le petit format. Le corps conserve une épaisseur de 36, les anneaux une épaisseur minimale de 18 : aucun détail sous 2,25 px dans le symbole à 32 px.

Les contours sont construits à partir des intersections exactes des cercles, puis arrondis à deux décimales. Les deux évidements sont réels, sans aplat de fond simulant un trou. Le lettrage est dessiné spécialement avec des courbes simples et des contreformes ouvertes, et ne provient d’aucune police.

La bibliothèque fournit un repère de métier et une comparaison visuelle, pas une recherche d’antériorité exhaustive. La disponibilité juridique du signe et du nom n’a pas été vérifiée.
