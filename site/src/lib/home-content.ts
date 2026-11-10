export const features = [
  ["Serveur auto-hébergé", "Un processus Node 22, SQLite et des fichiers sur disque. Docker et Caddy pour le HTTPS."],
  ["Plusieurs coffres", "Autant de coffres que voulu sur un serveur. Leur création est protégée par un code."],
  ["Invitations par lien", "Un code lisible, valable 7 jours, pour inviter jusqu’à 5 personnes."],
  ["Synchro automatique", "Après 2 secondes de calme, à l’ouverture et toutes les 5 minutes par sécurité."],
  ["Temps quasi réel", "L’extension vérifie les nouvelles révisions toutes les 2,5 secondes et récupère les changements."],
  ["Fusion ligne à ligne", "Fusion à trois versions pour les fichiers .md, .txt et .csv. Si la même ligne diverge, les deux versions sont conservées et une notification apparaît."],
  ["Images et PDF", "En cas de conflit, ta version reste dans une copie de conflit et la version distante prend sa place."],
  ["Suppressions récupérables", "Les fichiers supprimés par les autres vont dans la corbeille locale .trash."],
  ["Garde-fou", "Si plus de la moitié du coffre et plus de 20 fichiers disparaissent d’un coup, le serveur ne supprime rien."],
  ["Activité du groupe", "Les membres et les 40 derniers changements, accessibles depuis l’extension."],
  ["Dossiers non partagés", "Choisis les dossiers à exclure. Le dossier .obsidian n’est jamais partagé."],
  ["Historique conservé", "Le serveur garde toutes les versions. La restauration dans l’extension est prévue en 0.2."],
  ["Ordinateur et mobile", "La même extension sur ordinateur, Android et iOS, grâce à l’API d’Obsidian."],
];

export const faq = [
  ["Est-ce gratuit ?", "Cordée est gratuit et open source, sous licence MIT. La personne qui héberge paie seulement son serveur et, si nécessaire, son nom de domaine. Les amis n’ont pas besoin de compte GitHub."],
  ["Tout le monde doit savoir gérer un serveur ?", "Une seule personne héberge Cordée. Les autres installent l’extension, ouvrent leur invitation dans Obsidian et renseignent leur prénom."],
  ["Que se passe-t-il si on modifie la même note ?", "Cordée fusionne les changements ligne à ligne. Si deux versions modifient la même ligne différemment, il les garde à la suite et t’en informe. L’édition simultanée avec les curseurs des autres est prévue en 0.3."],
  ["Mes notes sont-elles chiffrées ?", "HTTPS protège les échanges. En version 0.1, l’hébergeur peut lire les fichiers de son serveur : il faut lui faire confiance. Le chiffrement de bout en bout optionnel est prévu en 0.4."],
  ["Puis-je l’essayer sur mon coffre habituel ?", "La version 0.1 est en test : fais d’abord une copie de ton coffre. Pour rejoindre un groupe, pars de préférence d’un coffre vide. Garde également des sauvegardes du serveur."],
];
