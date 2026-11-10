import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowRight, Info, Terminal } from "lucide-react";
import { CodeBlock } from "@/components/code-block";
import { Button } from "@/components/ui/button";
import { InstallPlugin } from "@/components/install-plugin";
import { repository } from "@/components/site-chrome";

export const metadata: Metadata = { title: "Déployer le serveur", description: "Héberge Cordée sur ton VPS avec Docker et Caddy, avec un proxy existant ou directement avec Node. Installe ensuite l’extension Obsidian." };

const variables = [
  ["CORDEE_PORT", "Port d’écoute du serveur.", "8787"],
  ["CORDEE_DONNEES", "Dossier contenant la base, les fichiers et le code de création.", "./donnees (sans Docker) ; /donnees dans Docker"],
  ["CORDEE_CODE_CREATION", "Code nécessaire pour créer un coffre.", "Généré dans code-creation.txt"],
  ["CORDEE_URL_PUBLIQUE", "Adresse HTTPS publique du serveur, utilisée pour les invitations.", "Aucune ; ex. https://cordee.exemple.fr"],
  ["CORDEE_TAILLE_MAX_MO", "Taille maximale d’un fichier en mégaoctets.", "50"],
  ["CORDEE_DERRIERE_PROXY", "1 : utilise X-Real-IP, obligatoirement écrasé par le proxy de confiance.", "Désactivé"],
  ["CORDEE_PAGE_INVITATION", "Adresse de la page d’invitation de ce site, sans fragment.", "À définir ; ex. https://cordee.vercel.app/rejoindre"],
  ["CORDEE_DOMAINE", "Domaine utilisé par Docker Compose et Caddy.", "À définir ; ex. cordee.exemple.fr"],
  ["CORDEE_PORT_LOCAL", "Port local de la variante avec proxy existant.", "8800"],
];

export default function DeployPage() {
  return <main id="contenu" className="shell pb-20 pt-12 sm:pt-16">
    <div className="max-w-2xl"><p className="eyebrow">Guide de déploiement</p><h1 className="mt-4 text-[38px] font-medium leading-tight tracking-[-.045em] sm:text-5xl">Ta cordée commence ici.</h1><p className="mt-5 text-[15px] leading-7 text-soft">Une personne héberge le serveur. Tous les autres installent simplement l’extension et rejoignent avec un lien.</p><div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-xs text-soft"><span>Node 22.18+</span><span>~25 Mo de RAM</span><span>Aucune dépendance npm côté serveur</span></div></div>
    <Button asChild className="mt-8"><a href="#preparer">Héberger Cordée <ArrowDown aria-hidden="true" /></a></Button>
    <div className="mt-8 flex gap-3 rounded-lg border border-input p-4 text-xs text-soft"><Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><p>Version 0.1 en test, fais une copie de ton coffre. Prévois des sauvegardes du serveur. Le site va sur Vercel ; le serveur Cordée et ses données restent sur ton VPS.</p></div>
    <div className="mt-12 grid items-start gap-12 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16">
      <aside className="lg:sticky lg:top-8"><nav aria-label="Sommaire du guide" className="flex flex-wrap gap-x-5 gap-y-3 text-xs text-soft lg:flex-col"><a href="#preparer">01 / Préparer le VPS</a><a href="#docker">02 / Docker + Caddy</a><a href="#proxy">03 / Proxy existant</a><a href="#node">04 / Sans Docker</a><a href="#variables">05 / Variables</a><a href="#extension">06 / L’extension</a><a href="#premier-coffre">07 / Le premier coffre</a></nav></aside>
      <div className="prose min-w-0">
        <section id="preparer" className="border-b border-border pb-10"><h2>01 / Préparer le terrain</h2><p>Il te faut un VPS, un domaine pointant vers son adresse et un accès au terminal. Pour un serveur neuf, installe Docker avec son plugin Compose, puis ouvre les ports 80 et 443 pour Caddy. Exemple fictif : fais pointer <code>cordee.exemple.fr</code> vers <code>203.0.113.10</code>.</p><p>Copie le dépôt sur le VPS. Toutes les commandes Docker ci-dessous se lancent depuis sa racine.</p><CodeBlock>{`git clone https://github.com/glm02/Obsidian-sync.git
cd Obsidian-sync`}</CodeBlock><p>Choisis ensuite le scénario adapté à ton serveur.</p><div className="mt-4 flex flex-wrap gap-3"><Button asChild variant="outline" size="sm"><a href="#docker">VPS neuf <ArrowDown aria-hidden="true" /></a></Button><Button asChild variant="outline" size="sm"><a href="#proxy">Proxy déjà installé <ArrowDown aria-hidden="true" /></a></Button><Button asChild variant="outline" size="sm"><a href="#node">Sans Docker <ArrowDown aria-hidden="true" /></a></Button></div></section>

        <section id="docker" className="border-b border-border py-10"><h2>02 / VPS neuf : Docker + Caddy</h2><p>Caddy s’occupe du certificat HTTPS. Copie le fichier d’exemple, puis mets ton domaine dans <code>CORDEE_DOMAINE</code>.</p><CodeBlock>{`cp .env.exemple .env
# Modifie .env : CORDEE_DOMAINE=cordee.exemple.fr
docker compose up -d
docker compose exec cordee cat /donnees/code-creation.txt`}</CodeBlock><p>La dernière commande affiche le code de création : garde-le pour créer le premier coffre. Les données persistent dans le volume <code>cordee-donnees</code>. Sauvegarde ce volume régulièrement, idéalement pendant l’arrêt du service pour garder la base et les fichiers cohérents.</p><h3>Utiliser la page d’invitation de ce site</h3><p>Dans le service <code>cordee</code> de <code>docker-compose.yml</code>, ajoute cette variable à la section <code>environment</code>. Remplace l’adresse par celle de ton déploiement Vercel, puis recrée le conteneur.</p><CodeBlock title="docker-compose.yml — service cordee, section environment">{`CORDEE_PAGE_INVITATION: https://cordee.vercel.app/rejoindre`}</CodeBlock><CodeBlock>{`docker compose up -d`}</CodeBlock></section>

        <section id="proxy" className="border-b border-border py-10"><h2>03 / VPS avec Caddy ou nginx existant</h2><p>Si les ports 80 et 443 sont déjà utilisés, lance seulement Cordée avec <a href={`${repository}/blob/main/deploy/compose-proxy-existant.yml`}>deploy/compose-proxy-existant.yml</a>. Il écoute sur <code>127.0.0.1:8800</code>. Le proxy existant publie cette adresse en HTTPS.</p><CodeBlock>{`CORDEE_DOMAINE=cordee.exemple.fr docker compose -f deploy/compose-proxy-existant.yml up -d --build
docker compose -f deploy/compose-proxy-existant.yml exec cordee cat /donnees/code-creation.txt`}</CodeBlock><p>Cette variante définit déjà <code>CORDEE_DERRIERE_PROXY=1</code>. Le proxy doit <strong className="text-foreground">écraser X-Real-IP</strong>, pour qu’un client ne puisse pas choisir son adresse et contourner le limiteur d’essais. Garde le port 8800 accessible uniquement en local.</p><h3>Avec Caddy</h3><p>Adapte le bloc fourni dans <a href={`${repository}/blob/main/deploy/cordee.caddy`}>deploy/cordee.caddy</a>, ajoute-le à ta configuration Caddy puis valide et recharge cette configuration.</p><CodeBlock title="Bloc de site Caddy">{`cordee.exemple.fr {
    reverse_proxy 127.0.0.1:8800 {
        header_up X-Real-IP {remote_host}
        flush_interval -1
    }
}`}</CodeBlock><p><code>flush_interval -1</code> transmet immédiatement le flux d’événements de synchronisation.</p><h3>Avec nginx</h3><p>Ajoute ce bloc au serveur HTTPS existant de ton domaine. Conserve sa configuration TLS.</p><CodeBlock title="nginx — dans le bloc server HTTPS">{`location / {
    proxy_pass http://127.0.0.1:8800;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
}`}</CodeBlock><h3>Si Cloudflare est devant le proxy</h3><p>Autorise seulement les plages d’adresses Cloudflare à joindre les ports 80/443 de ton serveur. C’est nécessaire avant de faire confiance à <code>CF-Connecting-IP</code>. Dans le bloc Caddy, remplace la ligne <code>header_up X-Real-IP</code> par :</p><CodeBlock title="Caddy — variante Cloudflare">{`header_up X-Real-IP {http.request.header.CF-Connecting-IP}`}</CodeBlock><p>Dans nginx, remplace de même la ligne <code>proxy_set_header X-Real-IP</code> par :</p><CodeBlock title="nginx — variante Cloudflare">{`proxy_set_header X-Real-IP $http_cf_connecting_ip;`}</CodeBlock><p>Garde <code>CORDEE_DERRIERE_PROXY=1</code>. Pour utiliser la page d’invitation Vercel, ajoute <code>CORDEE_PAGE_INVITATION</code> dans <code>environment</code> du fichier <code>deploy/compose-proxy-existant.yml</code>, comme dans l’exemple Docker précédent, puis relance la commande Compose de cette variante.</p></section>

        <section id="node" className="border-b border-border py-10"><h2>04 / Sans Docker : Node 22.18+</h2><p>Le serveur utilise uniquement les modules intégrés à Node. Pas de <code>npm install</code> à faire côté serveur. Vérifie ta version, puis lance Cordée :</p><CodeBlock>{String.raw`node --version
cd server
CORDEE_URL_PUBLIQUE=https://cordee.exemple.fr \
CORDEE_PAGE_INVITATION=https://cordee.vercel.app/rejoindre \
CORDEE_DERRIERE_PROXY=1 \
npm start`}</CodeBlock><p>Ces commandes sont prévues pour le shell Linux de ton VPS. Place un proxy HTTPS devant le port <code>8787</code>, en reprenant le bloc Caddy ou nginx ci-dessus avec <code>127.0.0.1:8787</code>. Il doit écraser <code>X-Real-IP</code>. Bloque l’accès public direct à ce port.</p><p>Garde le processus actif avec le gestionnaire de services de ton VPS, puis lis le code dans un autre terminal, depuis le dossier <code>server/</code> :</p><CodeBlock>{`cat donnees/code-creation.txt`}</CodeBlock><p>Si tu as changé <code>CORDEE_DONNEES</code>, adapte ce chemin. Configure toujours HTTPS : les jetons d’accès passent dans les en-têtes des requêtes.</p></section>

        <section id="variables" className="border-b border-border py-10"><h2>05 / Les variables d’environnement</h2><p>Sans Docker, définis ces variables dans l’environnement du processus Node. Avec Docker, ajoute les variables serveur à la section <code>environment</code> du service <code>cordee</code> : les ajouter seulement au fichier <code>.env</code> ne les transmet pas automatiquement au conteneur.</p><table className="data-table"><caption className="sr-only">Configuration de Cordée</caption><thead><tr><th scope="col">Variable</th><th scope="col">Rôle et valeur par défaut</th></tr></thead><tbody>{variables.map(([name, role, value]) => <tr key={name}><td><code className="text-[10px]! sm:text-xs!">{name}</code></td><td><p className="m-0!">{role}</p><span className="mt-1 block text-xs text-muted-foreground">{value}</span></td></tr>)}</tbody></table></section>

        <section id="extension" className="border-b border-border py-10"><h2>06 / Installer l’extension Obsidian</h2><InstallPlugin /></section>

        <section id="premier-coffre" className="pt-10"><h2>07 / Créer le coffre et inviter les amis</h2><p>Dans <strong className="text-foreground">Réglages → Cordée → Créer</strong>, renseigne l’adresse du serveur, le nom du coffre, ton prénom et le code de création récupéré plus haut. Tout le coffre est envoyé, à l’exception des dossiers exclus et de <code>.obsidian/</code>.</p><p>Utilise ensuite la commande <strong className="text-foreground">« Créer une invitation pour un ami »</strong> et envoie le lien. Ton ami part de préférence d’un coffre vide, ouvre <strong className="text-foreground">Réglages → Cordée → Rejoindre</strong>, puis colle le lien et renseigne son prénom.</p><div className="mt-6 flex items-start gap-3 rounded-lg border border-input p-4"><Terminal className="mt-1 size-4 shrink-0 text-soft" aria-hidden="true" /><p className="m-0! text-xs!">Les commandes « Synchroniser maintenant » et « Voir qui a modifié quoi » restent accessibles dans la palette de commandes d’Obsidian.</p></div><div className="mt-8"><Button asChild variant="outline"><Link href="/">Retour à Cordée <ArrowRight aria-hidden="true" /></Link></Button></div></section>
      </div>
    </div>
  </main>;
}
