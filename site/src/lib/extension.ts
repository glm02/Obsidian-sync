/**
 * Ce que fait l'extension Cordée, en langage simple, pour la page « Fonctionnalités ».
 * Source : le code de plugin/main.js et CHANGELOG.md. À mettre à jour à chaque version
 * (la version doit suivre manifest.json, sinon le site annonce une version qui n'existe pas).
 */
export const VERSION_EXTENSION = "0.1.6";

export type Fonction = { titre: string; texte: string };
export type Groupe = { id: string; titre: string; resume: string; fonctions: Fonction[] };

export const groupes: Groupe[] = [
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
      { titre: "Suppression massive retenue", texte: "Si plus de 20 éléments et plus de la moitié du coffre disparaissent d’un coup, rien n’est supprimé chez les autres. Si c’est voulu, tu confirmes en un clic." },
      { titre: "Un fichier bloqué ne bloque pas tout", texte: "Un fichier impossible à écrire sur ton appareil est mis de côté, nommé, et réessayé à chaque synchro ; tout le reste continue." },
      { titre: "Messages qui disent la vraie cause", texte: "« Le serveur ne répond pas » seulement quand c’est le cas ; sinon le nom du fichier et la raison." },
      { titre: "Ami pas à jour ? Tu le sais", texte: "Si un membre garde une version trop ancienne pour gérer les dossiers, Cordée te donne son nom." },
      { titre: "Fichiers trop gros signalés", texte: "Au-delà de 50 Mo (limite réglable par l’hébergeur), le fichier n’est pas envoyé et Cordée le dit." },
    ],
  },
];

export const ouTrouver: Fonction[] = [
  { titre: "L’icône Cordée", texte: "Dans la barre de gauche d’Obsidian : elle ouvre le panneau de partage (état, pause, inviter, membres, profil)." },
  { titre: "La palette de commandes", texte: "Ctrl+P (Cmd+P sur Mac), tape « Cordée » : synchroniser, pause, inviter, voir l’activité, confirmer les suppressions." },
  { titre: "La barre d’état", texte: "En bas à droite : « à jour », « synchronisation… », « fichiers à vérifier » ou « en pause »." },
];

export type Version = { version: string; titre: string; points: string[] };

export const versions: Version[] = [
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
