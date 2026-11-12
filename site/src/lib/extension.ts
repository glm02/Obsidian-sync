/**
 * Ce que fait l'extension Cordée, en langage simple, pour la page « Fonctionnalités ».
 * Source : le code de plugin/main.js et CHANGELOG.md. À mettre à jour à chaque version
 * (la version doit suivre manifest.json, sinon le site annonce une version qui n'existe pas).
 */
export const VERSION_EXTENSION = "0.4.14";

export type Fonction = { titre: string; texte: string };
export type Groupe = { id: string; titre: string; resume: string; fonctions: Fonction[] };

export const groupes: Groupe[] = [
  {
    id: "moodle",
    titre: "Moodle",
    resume: "Tes cours arrivent tout seuls.",
    fonctions: [
      { titre: "Fichiers de cours", texte: "Choisis tes cours : PDF de cours, TD, TP et sujets arrivent dans le coffre, rangés par section, toutes les 6 h. Un fichier que tu as retouché n’est jamais écrasé." },
      { titre: "Annonces et devoirs", texte: "Les dernières annonces de chaque cours dans une note, et tes devoirs « à rendre » ou « rendu » dans la semaine." },
      { titre: "Tes notes, pour toi seul", texte: "« Mes notes Moodle » s’affichent sur ton appareil et ne sont jamais écrites dans le coffre partagé." },
      { titre: "Ton mot de passe reste à toi", texte: "Il sert une seule fois à obtenir un jeton d’accès, gardé sur ton appareil seulement. Ou colle directement le jeton depuis Moodle." },
    ],
  },
  {
    id: "geii",
    titre: "Logiciels de GEII",
    resume: "Tes fichiers de TP lisibles dans Obsidian.",
    fonctions: [
      { titre: "Code", texte: "Arduino (.ino), C pour PIC, MATLAB, Python, VHDL et assembleur s’ouvrent et se modifient dans Obsidian, avec un bouton pour les ouvrir dans le logiciel." },
      { titre: "LTspice et KiCad", texte: "Un schéma LTspice est dessiné ; un schéma KiCad est résumé en composants, valeurs et empreintes. Ces fichiers ne sont jamais fusionnés ligne à ligne." },
      { titre: "Calculs", texte: "Un bloc calc dans une note : R = 4.7k, C = 10µ, fc = 1/(2*pi*R*C), et les résultats s’affichent en notation ingénieur." },
    ],
  },
  {
    id: "semaine",
    titre: "La semaine",
    resume: "Cours, devoirs et révisions au même endroit.",
    fonctions: [
      { titre: "Le même agenda", texte: "Un emploi du temps commun s’ajoute une fois « pour toute la cordée » : chacun voit les mêmes cours." },
      { titre: "Emploi du temps", texte: "Colle le lien iCal de ton emploi du temps (ADE, Hyperplanning…) dans les réglages : tes cours s’affichent dans la vue Semaine, en grille sur ordinateur et en liste sur téléphone." },
      { titre: "Devoirs Moodle", texte: "Le lien « Exporter le calendrier » de Moodle ajoute tes devoirs à rendre, avec leur heure limite. Pas besoin de ton mot de passe." },
      { titre: "Agenda de la cordée", texte: "Un créneau ajouté (révision, projet, rendu) apparaît chez tout le monde. C’est une simple note partagée, modifiable à la main." },
      { titre: "Aujourd’hui", texte: "En tête du panneau Cordée : les cours qui restent aujourd’hui et les devoirs de la semaine." },
      { titre: "Liens privés", texte: "Tes liens de calendrier restent sur ton appareil : ils ne sont ni synchronisés ni partagés, et ne s’affichent que par leur domaine." },
    ],
  },
  {
    id: "synchro",
    titre: "La synchronisation",
    resume: "Tu écris, les autres reçoivent. Rien à cliquer.",
    fonctions: [
      { titre: "Automatique", texte: "Deux secondes après une modification, à l’ouverture d’Obsidian, puis toutes les 5 minutes par sécurité." },
      { titre: "Quasi instantanée", texte: "Les changements de tes amis arrivent en quelques secondes, sans recharger." },
      { titre: "Même hors d’Obsidian", texte: "Un fichier copié, supprimé ou ajouté depuis l’explorateur de fichiers (ou un git pull) est pris en compte comme les autres." },
      { titre: "Sur téléphone aussi", texte: "Android et iOS : l’extension n’utilise que ce qu’Obsidian fournit sur mobile." },
      { titre: "Pause quand tu veux", texte: "Mets la synchro en pause, puis reprends. « Synchroniser maintenant » marche même en pause." },
    ],
  },
  {
    id: "fichiers",
    titre: "Notes, fichiers et dossiers",
    resume: "Deux personnes sur la même note ? Rien ne se perd.",
    fonctions: [
      { titre: "Fusion ligne à ligne", texte: "Une note modifiée par deux personnes garde les deux modifications. Si la même ligne change des deux côtés, les deux versions restent l’une sous l’autre et tu es prévenu." },
      { titre: "Images et PDF", texte: "Modifiés des deux côtés, la version de l’autre prend la place et la tienne est gardée en « (conflit Prénom date) »." },
      { titre: "Dossiers partagés", texte: "Les dossiers, même vides, arrivent chez tout le monde. Supprimer un dossier le supprime aussi chez les autres, sous-dossiers compris." },
      { titre: "Corbeille plutôt qu’effacement", texte: "Ce qu’un ami supprime part dans la corbeille de ton coffre : tu peux toujours le récupérer." },
      { titre: "Dossiers privés", texte: "Réglage « Dossiers non partagés » : ce qui s’y trouve reste sur ton appareil. Les réglages d’Obsidian ne sont jamais partagés." },
    ],
  },
  {
    id: "groupe",
    titre: "Le groupe",
    resume: "Savoir qui est là et qui a changé quoi.",
    fonctions: [
      { titre: "Qui est là", texte: "Une pastille au nom de ton ami sur la note qu’il a ouverte, « en ligne » dans le panneau, et une alerte quand il ouvre la tienne. Une note d’un dossier privé n’est jamais annoncée, et tu peux masquer ta présence." },
      { titre: "Modifications surlignées", texte: "Dans la note, les lignes qu’un ami vient de changer sont surlignées à sa couleur, avec son nom et un bouton « Vu ». Un point signale aussi la note dans l’explorateur." },
      { titre: "À voir", texte: "En tête du panneau, les notes modifiées depuis ta dernière visite. Un clic t’emmène directement sur la modification." },
      { titre: "Invitations en un lien", texte: "Un lien valable 7 jours pour 5 personnes. Il s’ouvre directement dans Obsidian, ou un code seul suffit si le serveur est déjà connu." },
      { titre: "Membres et activité", texte: "La liste des membres avec leur photo, et les 40 derniers changements : qui a modifié quoi, et quand." },
      { titre: "Comparer une version", texte: "Sur un changement, vois ce qui a bougé (rouge : avant, vert : après) et ouvre la note directement sur le passage modifié." },
      { titre: "Ton profil", texte: "Choisis ton nom affiché et ta photo. La photo est recadrée sur ton appareil et ses métadonnées sont retirées avant l’envoi." },
    ],
  },
  {
    id: "securite",
    titre: "Les garde-fous",
    resume: "Pensé pour qu’un accident ne devienne pas une catastrophe.",
    fonctions: [
      { titre: "Remonter le temps", texte: "Clic droit sur une note → « Historique Cordée » : toutes ses versions. Restaure n’importe laquelle, ou récupère un fichier supprimé, en deux clics." },
      { titre: "Suppression massive retenue", texte: "Si plus de 20 éléments et plus de la moitié du coffre disparaissent d’un coup, rien n’est supprimé chez les autres. Si c’est voulu, tu confirmes en un clic." },
      { titre: "Un fichier bloqué ne bloque pas tout", texte: "Un fichier impossible à écrire sur ton appareil est mis de côté, nommé, et réessayé à chaque synchro ; tout le reste continue." },
      { titre: "Messages qui disent la vraie cause", texte: "« Le serveur ne répond pas » seulement quand c’est le cas ; sinon le nom du fichier et la raison." },
      { titre: "Ami pas à jour ? Tu le sais", texte: "Si un membre garde une version trop ancienne pour gérer les dossiers, Cordée te donne son nom." },
      { titre: "Fichiers trop gros signalés", texte: "Au-delà de 50 Mo (limite réglable par l’hébergeur), le fichier n’est pas envoyé et Cordée le dit." },
    ],
  },
];

export const ouTrouver: Fonction[] = [
  { titre: "Le panneau latéral", texte: "L’icône Cordée (barre de gauche) ouvre le panneau dans la barre latérale droite : il reste visible pendant que tu écris." },
  { titre: "La palette de commandes", texte: "Ctrl+P (Cmd+P sur Mac), tape « Cordée » : synchroniser, pause, inviter, voir l’activité, confirmer les suppressions." },
  { titre: "La barre d’état", texte: "En bas à droite : « à jour », « synchronisation… » ou « en pause », et le nombre de notes à voir. Un clic ouvre le panneau." },
];

export type Version = { version: string; titre: string; points: string[] };

export const versions: Version[] = [
  {
    version: "0.4.14",
    titre: "Plus rapide, plus clair, plus fiable",
    points: [
      "Jauge de stockage du serveur dans le panneau : verte, orange puis rouge quand le disque se remplit.",
      "Les vidéos (mp4, mov…) restent sur l’appareil par défaut, les petits fichiers partent d’abord et la progression s’affiche (envoi 12/320).",
      "Synchronisation beaucoup plus rapide : les fichiers partent et arrivent 4 par 4, et l’arrivée dans un gros coffre ne ralentit plus.",
      "Fini le blocage sur « synchronisation… » : une requête sans réponse est abandonnée et la synchro repart toute seule. Progression visible (12/240).",
      "Panneau en accordéon avec des icônes, barre latérale compacte, réglages épurés (Calendriers et Moodle repliables).",
      "Clic sur un membre : sa fiche, ses changements ou ton profil. « En cours » ou « Dans 25 min » sous les cours du jour.",
      "Nouvelle commande « Ouvrir la prochaine note à voir » et « Historique Cordée » au clic droit sur un fichier.",
    ],
  },
  {
    version: "0.4.0",
    titre: "Moodle, logiciels GEII et le même agenda",
    points: [
      "Moodle : tes fichiers de cours arrivent dans le coffre, avec les annonces et les devoirs (rendu ou à rendre) dans la semaine. Tes notes restent sur ton appareil.",
      "Logiciels de GEII : code Arduino, C, MATLAB, Python, VHDL dans Obsidian, schémas LTspice dessinés, schémas KiCad résumés, et des blocs de calcul en notation ingénieur.",
      "Un emploi du temps ajouté pour toute la cordée : tout le monde voit les mêmes cours.",
      "Qui est en ligne, sur quelle note, et depuis quand l’autre n’est plus venu.",
    ],
  },
  {
    version: "0.3.0",
    titre: "La semaine de la cordée",
    points: [
      "Une vue Semaine : ton emploi du temps (lien iCal), tes devoirs Moodle à rendre et l’agenda de la cordée au même endroit.",
      "« Ajouter un créneau » : révision, projet, rendu… visible dans la semaine de chaque membre.",
      "« Aujourd’hui » en tête du panneau : les cours qui restent et les devoirs de la semaine.",
      "Tes liens de calendrier restent sur ton appareil, jamais partagés.",
    ],
  },
  {
    version: "0.2.0",
    titre: "La V2 : ensemble, en direct",
    points: [
      "Un panneau Cordée toujours visible dans la barre latérale, qui se met à jour tout seul.",
      "Présence : qui est en ligne et sur quelle note, avec une pastille à son nom dans l’explorateur.",
      "Historique de chaque note et restauration d’une ancienne version, ou d’un fichier supprimé, en deux clics.",
      "Une alerte quand un ami modifie la note que tu as sous les yeux.",
    ],
  },
  {
    version: "0.1.7",
    titre: "On voit enfin ce qui a changé",
    points: [
      "Les lignes modifiées par un ami sont surlignées à sa couleur dans la note, avec son nom et un bouton « Vu ».",
      "Un point dans l’explorateur à côté des notes modifiées, jusqu’à ce que tu les ouvres.",
      "Section « À voir » dans le panneau : un clic ouvre la note sur la modification.",
      "Panneau entièrement refait, barre d’état cliquable qui annonce ce qui est à voir.",
    ],
  },
  {
    version: "0.1.6",
    titre: "Les dossiers suivent partout",
    points: [
      "Supprimer un dossier le supprime aussi chez les amis, sous-dossiers compris, depuis Obsidian ou depuis l’explorateur de fichiers.",
      "Une suppression massive voulue se confirme en un clic (bouton dans l’alerte ou commande).",
      "Cordée nomme les amis dont l’extension est trop ancienne pour gérer les dossiers.",
      "Un dossier vide n’est plus retenu par un Thumbs.db ou un .DS_Store.",
    ],
  },
  {
    version: "0.1.5",
    titre: "Plus de synchro bloquée",
    points: [
      "Un fichier impossible à écrire ne bloque plus toute la synchronisation : il est mis de côté et réessayé.",
      "Les dossiers renommés en ne changeant que les majuscules ne posent plus problème sur Windows et macOS.",
      "Le message d’erreur dit la vraie cause au lieu de « vérifie ta connexion ».",
      "Dossiers partagés, comparaison de versions et activité par membre.",
    ],
  },
  {
    version: "0.1.4",
    titre: "Un profil à toi",
    points: [
      "Nom affiché modifiable sans perdre l’historique de tes changements.",
      "Serveur et nom retenus sur l’appareil pour les prochains coffres.",
      "Un code d’invitation seul suffit quand le serveur est connu.",
    ],
  },
  {
    version: "0.1.3",
    titre: "Le panneau de partage",
    points: [
      "Pause et reprise, synchro manuelle même en pause.",
      "Membres, photos et 40 derniers changements dans le panneau.",
      "Fichiers de plus de 50 Mo signalés au lieu d’être ignorés en silence.",
    ],
  },
  {
    version: "0.1.2",
    titre: "Installer sans effort",
    points: [
      "Installation depuis le catalogue d’Obsidian, BRAT ou une archive ZIP.",
      "Invitations ouvertes directement dans Obsidian.",
      "Choix des dossiers privés avant le premier envoi.",
    ],
  },
  {
    version: "0.1.0",
    titre: "La première cordée",
    points: [
      "Serveur auto-hébergé et extension Obsidian : synchro automatique, fusion des notes, corbeille, garde-fou.",
    ],
  },
];
