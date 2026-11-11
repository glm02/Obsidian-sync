# Tes fichiers de GEII dans Cordée

Ouvre un fichier `.ino`, `.c`, `.h`, `.m`, `.py`, `.vhd`, `.asm` ou `.s` dans
Obsidian pour lire et modifier son code dans une zone monospace avec numéros de
ligne. Les changements utilisent la sauvegarde normale d’Obsidian et sont donc
synchronisés avec Cordée. **Ouvrir dans le logiciel** sauvegarde puis lance
l’application associée au fichier sur ton appareil. Il faut l’avoir installée ;
l’ouverture externe peut ne pas être disponible sur ton téléphone.

Si un autre module Obsidian gère déjà une extension, Cordée lui laisse la main.
Si ta version d’Obsidian ne propose pas l’API de vues de fichiers, Cordée continue
à fonctionner ; seuls ces nouveaux éditeurs et aperçus ne sont pas enregistrés.

## Schémas

Un fichier `.asc` affiche un aperçu SVG en lecture seule : fils, masse, noms des
nœuds, composants sous forme de rectangles avec référence et valeur, et textes.
Tu peux agrandir, réduire ou ajuster à la largeur. Les symboles sont simplifiés :
leurs broches et leur orientation ne sont pas reproduites fidèlement. Pour
vérifier les connexions, modifier ou simuler ton circuit, utilise **Ouvrir dans
LTspice** (l’application associée au fichier sur ton appareil).

Dans une note, tu peux aussi afficher le même aperçu :

````markdown
```ltspice
[[montage.asc]]
```
````

Le lien est résolu par Obsidian depuis la note, comme un lien habituel. Tu peux
aussi coller directement le contenu du fichier `.asc` dans ce bloc. Le bloc est
recalculé quand Obsidian affiche à nouveau la note ; il ne surveille pas les
modifications du fichier lié en direct.

Un fichier `.kicad_sch` moderne affiche en lecture seule un tableau des composants
placés (référence, valeur, empreinte) et la liste des sous-feuilles du fichier.
Le contenu de chaque sous-feuille se consulte dans son propre fichier. Le dessin
reste dans KiCad, accessible avec **Ouvrir dans KiCad**. Les fichiers `.kicad_pcb`
et `.kicad_pro` sont synchronisés sans aperçu spécifique.

**Conflits : seules les extensions `.md`, `.txt` et `.csv` sont fusionnées ligne
à ligne.** Tous les fichiers GEII gardent la stratégie existante de copie de
conflit : Cordée conserve les deux versions complètes si deux personnes les
modifient. C’est volontaire pour LTspice et KiCad : une fusion de leurs lignes
pourrait produire un schéma incohérent. Un aperçu en lecture seule n’écrit jamais
dans le fichier source. Compare les copies dans le logiciel avant de choisir.

## Calculs dans une note

````markdown
```calc
R = 4.7kΩ
C = 10uF
tau = R*C
fc = 1/(2*pi*tau)
```
````

Chaque ligne non vide doit être `nom = expression`. Les résultats s’affichent en
tableau : ici **4,7 kΩ**, **10 µF**, **47 ms** et **3,386 Hz**. Les variables des
lignes précédentes sont réutilisables dans le même bloc ; une erreur indique la
ligne et laisse les lignes suivantes se calculer. Si tu redéfinis une variable
avec une erreur, sa précédente valeur est retirée pour éviter un résultat ancien.

Tu peux écrire les décimales avec un point ou une virgule, les nombres
scientifiques (`1e-6`), `+`, `-`, `*`, `/`, `^` et des parenthèses. Les puissances
s’associent à droite (`2^3^2 = 512`) et passent avant le signe (`-2^2 = -4`).
Les fonctions sont `sqrt(...)`, `log10(...)`, `ln(...)`, `exp(...)` ; `pi` est
disponible. La multiplication doit être explicite, sauf entre un nombre et son
unité (`10 µF`).

Unités reconnues : `Ω` (ou `ohm`), `F`, `s`, `Hz`, `A`, `V`, `H`, `W`. Préfixes :
`p`, `n`, `µ` (ou `u`), `m`, `k`, `M`, `G` ; la casse compte. Un préfixe seul
est un multiplicateur sans unité : `4.7k` vaut 4 700. Écris `4.7kΩ` pour obtenir
des ohms. Les calculs combinent les unités : Ω × F donne des secondes et 1/s
donne des hertz. Les additions d’unités incompatibles et les résultats non finis
sont signalés. Les logarithmes et l’exponentielle attendent une valeur sans unité.

L’affichage conserve quatre chiffres significatifs au maximum, avec un préfixe
d’ingénieur entre pico et giga, ou un exposant explicite au-delà. Les noms des
unités, préfixes, constantes et fonctions sont réservés. Le calculateur limite
chaque expression à 2 000 caractères et chaque bloc à 1 000 lignes pour rester
utilisable sur téléphone. Il lit une grammaire mathématique fermée : aucune
instruction JavaScript, aucun accès à un objet ni appel arbitraire n’est exécuté.

## Vérification

Les exemples synthétiques `plugin/test/exemples/rc.asc` et `rc.kicad_sch` servent
aux tests de lecture. Le second est un extrait de structure pour tester le
lecteur, pas un projet KiCad complet destiné à la fabrication.

Lance `cd server` puis `npm test`, et `node --check plugin/main.js` depuis la
racine. Les tests d’interface simulent l’API Obsidian ; ils ne remplacent pas un
essai dans Obsidian sur ordinateur et sur téléphone avec les logiciels installés.
