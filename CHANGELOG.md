# Nouveautés

## 0.4.16

- **Clic droit sur un dossier** : « Ne pas partager ce dossier » ou « Partager à nouveau ce dossier ».
- **Résumé d’absence** après la première synchro : « Pendant ton absence : Paulo a modifié 5 notes ».
- **Filtre** dans « Derniers changements », sans tenir compte des majuscules ni des accents.
- **Menu rapide** au clic sur « Cordée » dans la barre du bas : synchroniser, pause, panneau, semaine, prochaine note à voir.

## 0.4.15

- **Toutes les pages épurées** : réglages (options du coffre repliées), semaine (créneaux courts qui ne se chevauchent plus), fenêtres Moodle, historique, profil, invitation et fiche membre. Moins de texte, une action principale par page, lisible sur téléphone.

## 0.4.14

- **Jauge de stockage** dans le panneau : remplissage du disque du serveur, place libre et poids du coffre. Verte, orange à 75 %, rouge à 90 %. Demande le serveur à jour (route `/stockage`).
- **Icônes rétablies** : Obsidian imposait une marge intérieure qui écrasait les icônes à 4 px. Si une icône manque, le bouton reprend son texte.
- Panneau épuré : accordéons plus sobres, chemins longs tronqués avec infobulle, espacements harmonisés.

## 0.4.13

- **Vidéos non partagées par défaut** : les vidéos (mp4, mov, mkv…) restent sur l’appareil. Un réglage « Partager les vidéos » les réactive. Cause du blocage : 29 vidéos de cours Moodle (743 Mo) monopolisaient la synchro.
- **Petits fichiers d’abord** : les notes et petits fichiers partent avant les gros, et le statut affiche « synchronisation… envoi 12/320 ».
- L’état est sauvegardé tous les 20 fichiers envoyés : fermer Obsidian pendant un gros envoi ne fait rien repartir de zéro.

## 0.4.12

- **Activité réparée** : les lignes de « Derniers changements » ne se chevauchent plus.
- **Clic sur un membre** : un menu propose sa fiche (photo, présence, activité), ses changements, ou « Modifier mon profil » pour toi.
- Le site affiche la version à jour.

## 0.4.11

- **Fini le blocage sur « synchronisation… »** : une requête sans réponse est abandonnée après 45 s (plus pour un gros fichier) au lieu d’attendre pour toujours. Une coupure réseau relance la synchro toute seule 15 s plus tard.
- Une synchro ne peut plus tourner en boucle : au-delà de 5 tours d’affilée, la suite est reprogrammée.
- **Progression visible** pendant une grosse réception : « synchronisation… 12/240 ».

## 0.4.10

- **Barre latérale plus compacte** : texte et icônes plus petits, titres de section discrets.
- **Aujourd’hui** indique « En cours » ou « Dans 25 min » sous chaque cours.
- **Nouvelle commande** « Ouvrir la prochaine note à voir » : suit les modifications sans passer par le panneau.
- **Clic droit sur un fichier** → « Historique Cordée ».
- Noms de commandes et notifications raccourcis.

## 0.4.9

- **Panneau en accordéon** : Aujourd’hui, À voir, Les membres et Derniers changements s’ouvrent et se referment d’un clic ; l’état est retenu sur l’appareil.
- **Icônes à la place du texte** pour Synchroniser, Pause, Mon profil, Configurer, La semaine, Tout marquer comme vu et Actualiser (le nom s’affiche en infobulle). Le statut de synchronisation n’est plus tronqué en « … ».
- **Plus lisible sur ordinateur** : texte et boutons plus grands. Les membres sont rangés dans une grille régulière, et la barre d’état a un espace avant « en ligne ».

## 0.4.8

- **Synchronisation beaucoup plus rapide** : les fichiers partent et arrivent 4 par 4 au lieu d’un par un. Les prochains fichiers reçus se téléchargent pendant l’écriture du fichier courant.
- À l’arrivée dans un gros coffre, la liste des fichiers n’est plus relue pour chaque changement reçu : l’arrivée devient quasi linéaire au lieu de ralentir avec la taille du coffre.
- Quand le flux en direct fonctionne, le serveur n’est plus interrogé toutes les 2,5 s mais toutes les 15 s (présence) : moins de batterie et de réseau, surtout sur téléphone.

## 0.4.7

- **Réglages épurés** : le coffre partagé passe en premier ; Calendriers et Moodle deviennent des sections repliables. Inviter, Synchroniser, Activité et Mon profil tiennent sur une seule ligne. Les descriptions sont raccourcies et la connexion Moodle par le navigateur est mise en avant.

## 0.4.6

- **Panneau sans saccades** : l’actualisation en arrière-plan conserve l’activité affichée pendant la récupération. Les cartes et boutons inchangés sont réutilisés, y compris lors du filtrage ; le panneau ne se vide plus brièvement et ne perd plus le focus sur ces éléments.
- La présence se met à jour sur place. Un membre qui change de note ne provoque plus le rechargement de l’activité, et les textes identiques ne sont plus réécrits à chaque statut de synchronisation.
- La ligne de statut garde une hauteur stable pendant les synchronisations. En cas d’erreur d’actualisation, l’activité précédente reste consultable et le bouton Actualiser permet de réessayer.

## 0.4.5

- **Synchronisation plus rapide** : les fichiers enregistrés partent après 200 ms, sans attendre une pause dans la frappe. Les changements successifs ne repoussent plus le premier envoi.
- **Réception en direct** : l’extension utilise le flux de notifications du serveur pour récupérer les nouvelles versions dès leur annonce. Le sondage via `requestUrl` reste actif si le flux est bloqué ou interrompu. Reconnexion automatique, arrêt en pause et au déchargement, reprise immédiate.
- Les changements de même taille dont l’horodatage est identique sont détectés à chaque événement de fichier. Une modification pendant la lecture ne peut plus produire un envoi dont le contenu et l’empreinte diffèrent. Les dossiers exclus ne déclenchent pas d’envoi.

## 0.4.4

- La récupération Moodle respecte les fichiers explicitement exclus dans son suivi local : ils ne sont plus retéléchargés ni réintroduits dans l’index du cours après un nettoyage du coffre.

## 0.4.3

- **Cours Moodle illustrés** : cartes avec les vignettes officielles, titre, description courte, recherche par nom ou matière et ouverture du cours déjà récupéré. Affichage adapté aux écrans étroits.
- Les couvertures des cours sélectionnés sont copiées dans `_Médias/` et affichées dans `Cours.md`, avec la description et les aperçus des ressources PNG, JPEG, GIF et WebP. Les images déjà récupérées sont réutilisées et les modifications locales restent protégées.
- Les couvertures sont limitées à 5 Mo et vérifiées avant affichage. Un visuel absent ou refusé laisse le cours accessible. Les aperçus utilisent des adresses locales temporaires, sans jeton dans l’interface ni dans les notes.

## 0.4.2

- **Retour de connexion Moodle corrigé** : les liens de connexion contenant une clé privée alphanumérique de 64 caractères sont acceptés. Cette partie optionnelle reste ignorée ; seul le jeton de service web est enregistré. Les tests utilisent des clés fictives au format Moodle.

## 0.4.1

- **Connexion universitaire Moodle** : parcours par navigateur pour les comptes dont les préférences n’affichent qu’une clé RSS. Après authentification sur le site de l’université, copier le lien « lancer l’application » dans la fenêtre de connexion Cordée. Le mot de passe reste sur le site ; seule la clé de service web est enregistrée localement. Le retour dans Cordée est manuel.
- Les adresses terminant par `/login/index.php` sont ramenées à la racine du site, en conservant un éventuel sous-dossier.
- Les erreurs Moodle distinguent un jeton rejeté ou expiré, une restriction réseau, un service indisponible et un accès refusé ; les réponses réseau et les secrets ne sont jamais affichés.

## 0.4.0

- **Qui est là** : chaque membre apparaît « en ligne · sur sa note », sinon « vu il y a 12 min », « vu hier » ou « pas encore connecté ». Une notification « Bruno vient de se connecter » (au plus une fois par demi-heure, désactivable), un point vert dans la barre d’état. « Masquer ma présence » cache aussi la dernière visite.
- **Le même agenda pour tous** : « Ajouter pour toute la cordée » écrit le lien de l’emploi du temps dans la note « Agenda de la cordée » ; chacun voit les mêmes cours. Un lien Moodle, personnel, reste refusé en partage.
- **Moodle, au-delà du calendrier** : connexion par l’accès officiel de l’application Moodle (le mot de passe sert une fois, seul un jeton est gardé sur l’appareil). Choix des cours dont les fichiers (PDF de cours, TD, TP, sujets) arrivent dans le coffre, `Moodle/<cours>/<section>/`, nouveaux et modifiés seulement, toutes les 6 h ; un fichier retouché dans le coffre n’est jamais écrasé. Une note d’index et les 20 dernières annonces par cours. Les devoirs avec leur état (rendu / à rendre) dans la semaine et « Aujourd’hui ». « Mes notes Moodle » : affichées sur l’appareil seulement, jamais écrites dans le coffre partagé.
- **Logiciels de GEII** : code Arduino, C (PIC), MATLAB, Python, VHDL, assembleur lisible et modifiable dans Obsidian, avec « Ouvrir dans le logiciel » ; schémas LTspice dessinés (lecture seule, zoom) ; schémas KiCad résumés (composants, valeurs, empreintes, feuilles) ; bloc ` ```calc ` dans les notes pour enchaîner des calculs avec préfixes (4.7k, 10µ…) et résultats en notation ingénieur, sans exécuter de code. Les fichiers LTspice et KiCad restent protégés des fusions ligne à ligne (copie de conflit).

## 0.3.0

- **La semaine** : une vue calendrier (icône calendrier ou commande « Ouvrir la semaine ») avec ton emploi du temps, tes devoirs Moodle et l’agenda de la cordée. Grille avec les heures et le trait « maintenant » sur ordinateur, liste par jour sur téléphone. Semaine précédente / suivante, cours qui se chevauchent côte à côte.
- **Emploi du temps** : colle le lien iCal de ton emploi du temps (ADE, Hyperplanning…) dans Réglages → Cordée → Calendriers. Répétitions (hebdomadaires, quotidiennes, exceptions) prises en compte ; dernière version gardée si le réseau manque ; actualisation toutes les 30 minutes.
- **Moodle** : le lien « Exporter le calendrier » de Moodle affiche tes devoirs « À rendre » (en pointillés), sans donner ton mot de passe.
- **Agenda de la cordée** : « Ajouter un créneau » (révision, projet, rendu…) écrit une ligne dans la note partagée « Agenda de la cordée » : le créneau apparaît dans la semaine de chaque membre. Depuis un cours : « Proposer ce créneau à la cordée » ou « Créer une note partagée » (dossier Agenda).
- **Aujourd’hui** en tête du panneau Cordée : les cours qui restent et les devoirs de la semaine.
- **Liens privés** : les liens iCal restent dans les réglages de cet appareil (jamais synchronisés, jamais partagés) et ne s’affichent que par leur domaine.
- Boutons du panneau : plus de lignes écrasées par les règles de boutons d’Obsidian.

## 0.2.0

- **Panneau toujours visible** dans la barre latérale droite (icône Cordée, barre d’état ou commande) : état, « À voir », membres et activité, qui se mettent à jour tout seuls.
- **Présence** : tu vois qui est en ligne et sur quelle note (pastille à son nom dans l’explorateur, « en ligne · sur … » dans le panneau, barre d’état). Une alerte te prévient quand un ami ouvre la note où tu es. Seul le chemin d’une note partagée est transmis, jamais celui d’un dossier non partagé ; la commande « Montrer ou masquer… » coupe la présence.
- **Historique d’une note** : clic droit sur un fichier → « Historique Cordée », ou commande. Toutes les versions, qui, quand ; un clic compare.
- **Restaurer une version** depuis la comparaison : « Restaurer cette version », « Revenir à la version d’avant » ou « Récupérer le fichier supprimé », avec confirmation. La version restaurée part chez tous ; l’ancienne reste dans l’historique.
- **Alerte en direct** quand un ami modifie la note que tu as sous les yeux.
- Serveur : routes de présence (en mémoire seulement, effacée après 90 s) et d’historique. Un ancien serveur continue de synchroniser ; ces fonctions s’affichent alors comme indisponibles.

## 0.1.7

- **Les modifications de tes amis se voient dans la note.** Les lignes ajoutées ou changées par un ami sont surlignées à sa couleur, avec une étiquette « Prénom · +3 lignes −1 ligne · il y a 5 min » et un bouton « Vu ». Une ligne que tu retouches n’est plus surlignée.
- **Un point dans l’explorateur de fichiers** à côté de chaque note modifiée par un ami, jusqu’à ce que tu l’ouvres.
- **Section « À voir » en tête du panneau** : les notes modifiées depuis ta dernière visite ; un clic ouvre la note sur la première modification. « Tout marquer comme vu » et des commandes pour une note ou pour tout.
- **Barre d’état cliquable** : elle ouvre le panneau et annonce « 3 à voir ».
- **Panneau refait** : boutons alignés, pastille d’état en couleur, nom du fichier en gras et dossier à part, « il y a 5 min », badges Ajouté / Modifié / Supprimé, comparaison de versions lisible, adapté aux thèmes clair et sombre et au téléphone.

## 0.1.6

- **Supprimer un dossier le supprime aussi chez les amis**, sous-dossiers compris, que ce soit depuis Obsidian ou depuis l’explorateur de fichiers du système. Les fichiers des dossiers retirés vont dans la corbeille du coffre chez les autres : rien n’est perdu.
- **Suppression massive confirmable.** Quand plus de 20 éléments (et plus de la moitié du coffre) disparaissent d’un coup, Cordée ne supprime toujours rien d’office, mais propose maintenant de confirmer : bouton dans l’alerte, commande « Confirmer les suppressions en attente » et panneau. La confirmation ne vaut que pour une synchronisation. L’alerte n’est plus répétée à chaque synchro.
- **Cordée dit qui n’est pas à jour.** Chaque extension annonce sa version au serveur ; si un ami a une version d’avant les dossiers, une alerte le nomme : chez lui les fichiers partent mais les dossiers restent. Seul le numéro de version est transmis.
- Un dossier supprimé par un ami disparaît aussi chez toi quand il ne contient que des fichiers parasites du système (`Thumbs.db`, `.DS_Store`, `desktop.ini`) ; un vrai fichier, même caché, le protège toujours.

## 0.1.5

- **Un fichier qui ne peut pas être écrit ne bloque plus la synchronisation.** Avant, un seul changement impossible à appliquer (par exemple un dossier que l’ami avait renommé en changeant seulement les majuscules, sur Windows ou macOS) arrêtait tout : plus rien n’arrivait et plus rien n’était envoyé, avec le message trompeur « vérifie ta connexion ». Le fichier est maintenant mis de côté, réessayé à chaque synchro, et signalé par son nom ; le reste continue.
- Sur un disque qui ne distingue pas les majuscules, un dossier ou un fichier existant prend la casse du serveur au lieu d’échouer ou d’être écrasé.
- Le message d’erreur dit la vraie cause : « le serveur ne répond pas » seulement quand c’est le cas, sinon le détail du problème.
- Les dossiers, même vides, sont partagés entre les membres (le serveur doit être à jour ; un ancien serveur continue de synchroniser les notes).
- Comparaison d’une version avec la précédente et activité filtrable par membre (serveur à jour requis).

## 0.1.4

- Nom affiché modifiable dans Mon profil, sans changer sa photo ni perdre l’attribution de ses changements.
- Serveur et nom retenus sur cet appareil pour préparer les nouveaux coffres, sans transférer les accès au groupe.
- Un code d’invitation seul suffit lorsque le serveur est déjà connu ; une invitation complète peut choisir un autre serveur.
- Formulaire de connexion allégé, création d’un nouveau partage à la demande et nom du coffre proposé automatiquement.
- L’API de profil accepte les modifications partielles du nom et de la photo, avec validation avant écriture.

## 0.1.3

- Pause et reprise de la synchronisation automatique, avec conservation du choix entre deux lancements.
- Synchronisation manuelle ponctuelle possible pendant la pause ; une opération déjà en cours n’est pas interrompue.
- Panneau avec état actualisé, nombre de fichiers partagés et heure de la dernière synchronisation réussie.
- Messages d’erreur utiles : accès retiré, serveur indisponible, limite de tentatives ou fichier trop volumineux.
- Signalement des fichiers de plus de 50 Mo au lieu d’un saut silencieux.
- Membres et 40 derniers changements accessibles depuis le panneau, avec actualisation.
- Photo de profil avec aperçu et confirmation, recadrée et réencodée localement avant l’envoi ; retrait possible.
- Photos ou initiales dans les membres et l’activité, avec attribution des changements par identifiant d’auteur.
- Styles adaptés au thème d’Obsidian, distribués dans la release et dans l’archive ZIP.
- Protection du dossier de configuration personnalisé, à l’envoi comme à la réception.

## 0.1.2

- Installation avec BRAT et archive ZIP unique.
- Invitations ouvertes directement dans Obsidian, sans adhésion automatique.
- Choix des dossiers privés avant le premier envoi.
- Détection des changements distants via le transport réseau natif d’Obsidian.

## 0.1.1

- Logo dans la barre de gauche et panneau de partage accessible en un clic.
