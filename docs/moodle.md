# Connecter Moodle à Cordée

Une clé **RSS** sert aux flux d’actualités. Elle ne donne pas accès à l’API utilisée par Cordée, même si elle apparaît dans « Préférences → Clés de sécurité ».

## Connexion par le site de l’université

Cette méthode est disponible à partir de Cordée 0.4.1. Elle utilise le parcours d’authentification mobile de Moodle, sans demander la création manuelle d’une clé dans les préférences.

1. Dans **Réglages → Cordée → Moodle**, renseigne l’adresse de ton Moodle.
2. Clique sur **Se connecter via le navigateur**, puis **Ouvrir la connexion Moodle**.
3. Dans le navigateur, utilise le bouton de ton université et connecte-toi normalement.
4. Moodle affiche une page avec un lien pour **lancer l’application**. Si le navigateur signale qu’aucune application ne peut ouvrir ce lien, ferme ce message et reste sur la page Moodle.
5. Fais un clic droit ou un appui long sur le lien de lancement, puis **Copier l’adresse du lien**.
6. Reviens dans Cordée, colle ce lien dans **Lien de retour Moodle**, puis clique sur **Terminer la connexion**.
7. Ouvre **Cours Moodle** pour choisir les cours à récupérer.

Le lien de retour commence par `cordee-moodle://token=`. Il contient un accès au compte : ne le partage pas. Le retour dans Cordée est manuel ; il n’ouvre pas automatiquement Obsidian.

Le mot de passe est saisi sur le site de l’université. Cordée extrait uniquement le jeton de service web du lien collé et le vérifie auprès du Moodle sélectionné avant de l’enregistrer dans sa configuration locale. Le lien complet et la clé privée éventuellement présente ne sont pas sauvegardés. Le champ est vidé après chaque tentative.

## Connexion avec une clé existante

Si les préférences proposent une clé pour **Moodle mobile web service**, elle peut être collée dans **Jeton Moodle**, puis testée avec le bouton **Tester**. Laisse le mot de passe vide dans ce cas.

Si seule la section **RSS** apparaît, utilise le parcours par navigateur ci-dessus.

## Limites

Le site doit autoriser le service mobile et l’authentification par navigateur. Il peut imposer des autorisations propres au compte ou forcer l’ouverture de son application officielle ; ces restrictions nécessitent une adaptation ou l’intervention de son administrateur. Les tests de Cordée simulent le retour et les appels API ; ils ne remplacent pas une connexion avec un compte universitaire réel.

Références : [clés de sécurité Moodle](https://docs.moodle.org/en/Security_keys), [parcours de connexion mobile dans le code officiel Moodle](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/admin/tool/mobile/launch.php).
