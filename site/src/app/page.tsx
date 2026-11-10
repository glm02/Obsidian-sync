import Link from "next/link";
import { ArrowRight, Check, ChevronRight, FileText, Folder, GitMerge, Globe, HardDrive, LockKeyhole, Plus, Radio, Server, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

const features = [
  ["Serveur auto-hébergé", "Un processus Node 22, SQLite et des fichiers sur disque. Docker et Caddy pour le HTTPS."],
  ["Plusieurs coffres", "Autant de coffres que voulu sur un serveur. Leur création est protégée par un code."],
  ["Invitations par lien", "Un code lisible, valable 7 jours, pour inviter jusqu’à 5 personnes."],
  ["Synchro automatique", "Après 2 secondes de calme, à l’ouverture et toutes les 5 minutes par sécurité."],
  ["Temps quasi réel", "Un flux d’événements annonce les changements. Les autres les récupèrent en quelques secondes."],
  ["Fusion ligne à ligne", "Fusion à trois versions pour les fichiers .md, .txt et .csv. Si la même ligne diverge, les deux versions sont conservées et une notification apparaît."],
  ["Images et PDF", "En cas de conflit, ta version reste dans une copie de conflit et la version distante prend sa place."],
  ["Suppressions récupérables", "Les fichiers supprimés par les autres vont dans la corbeille locale .trash."],
  ["Garde-fou", "Si plus de la moitié du coffre et plus de 20 fichiers disparaissent d’un coup, le serveur ne supprime rien."],
  ["Activité du groupe", "Les membres et les 40 derniers changements, accessibles depuis l’extension."],
  ["Dossiers non partagés", "Choisis les dossiers à exclure. Le dossier .obsidian n’est jamais partagé."],
  ["Historique conservé", "Le serveur garde toutes les versions. La restauration dans l’extension est prévue en 0.2."],
  ["Ordinateur et mobile", "La même extension sur ordinateur, Android et iOS, grâce à l’API d’Obsidian."],
];

const faq = [
  ["Est-ce gratuit ?", "Cordée est gratuit et open source, sous licence MIT. La personne qui héberge paie seulement son serveur et, si nécessaire, son nom de domaine. Les amis n’ont pas besoin de compte GitHub."],
  ["Tout le monde doit savoir gérer un serveur ?", "Une seule personne héberge Cordée. Les autres installent l’extension, collent le lien d’invitation dans ses réglages et renseignent leur prénom."],
  ["Que se passe-t-il si on modifie la même note ?", "Cordée fusionne les changements ligne à ligne. Si deux versions modifient la même ligne différemment, il les garde à la suite et t’en informe. L’édition simultanée avec les curseurs des autres est prévue en 0.3."],
  ["Mes notes sont-elles chiffrées ?", "HTTPS protège les échanges. En version 0.1, l’hébergeur peut lire les fichiers de son serveur : il faut lui faire confiance. Le chiffrement de bout en bout optionnel est prévu en 0.4."],
  ["Puis-je l’essayer sur mon coffre habituel ?", "La version 0.1 est en test : fais d’abord une copie de ton coffre. Pour rejoindre un groupe, pars de préférence d’un coffre vide. Garde également des sauvegardes du serveur."],
];

function VaultPreview() {
  return <div className="overflow-hidden rounded-lg border border-input bg-[#191919] text-xs shadow-2xl shadow-black/15" aria-label="Aperçu illustratif d’un coffre partagé">
    <div className="flex items-center justify-between border-b border-border px-5 py-3.5 text-soft"><span className="flex items-center gap-2"><Folder className="size-3.5" />Notre coffre</span><span className="flex items-center gap-1.5 text-[10px]"><span className="size-1.5 rounded-full bg-primary" />Synchronisé</span></div>
    <div className="grid grid-cols-[128px_minmax(0,1fr)] sm:grid-cols-[145px_minmax(0,1fr)]">
      <div className="border-r border-border px-3 py-6 text-soft sm:px-4"><div className="mb-4 flex items-center gap-1.5 text-[11px]"><ChevronRight className="size-3" />Notes partagées</div><div className="-mx-1 flex items-center gap-1.5 rounded-md bg-white/5 px-1 py-2 text-foreground"><FileText className="size-3 shrink-0" />Les idées.md</div><div className="mt-3 flex items-center gap-1.5"><FileText className="size-3 shrink-0" />Ressources.md</div><div className="mt-3 flex items-center gap-1.5"><Folder className="size-3 shrink-0" />Archives</div></div>
      <div className="min-w-0 px-4 py-7 sm:px-6"><p className="font-mono text-[10px] text-muted-foreground">NOTES / LES IDÉES</p><p className="mt-5 text-base font-medium tracking-tight sm:text-lg">On avance ensemble.</p><p className="mt-3 leading-6 text-soft">Un endroit pour nos idées,<br />nos découvertes et la suite.</p><div className="mt-6 border-l-2 border-primary pl-3"><p className="text-foreground">Et si on partageait nos notes ?</p><p className="mt-1 text-[10px] text-muted-foreground">Une idée ajoutée par un ami</p></div><div className="mt-7 h-px w-4/5 bg-white/5" /><div className="mt-3 h-px w-3/5 bg-white/5" /></div>
    </div>
    <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 text-[10px] text-soft"><span className="flex items-center gap-1.5"><LockKeyhole className="size-3" />Sur votre serveur</span><span>Illustration de la synchronisation</span></div>
  </div>;
}

export default function Home() {
  return <main id="contenu">
    <section className="shell grid items-center gap-12 pb-16 pt-16 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pb-24 lg:pt-24">
      <div>
        <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-input px-3 py-1 text-[11px] text-soft"><span className="size-1.5 rounded-full bg-primary" />Gratuit · Open source · Auto-hébergé</div>
        <h1 className="max-w-[630px] text-[38px] font-medium leading-[1.1] tracking-[-.05em] sm:text-[54px] xl:text-[60px]">Partage ton coffre Obsidian avec tes amis, <span className="text-soft">sur ton propre serveur.</span></h1>
        <p className="mt-6 max-w-md text-[15px] leading-7 text-soft">Vos notes avancent ensemble. Une personne héberge, les autres rejoignent avec un lien. Sur ordinateur comme sur téléphone.</p>
        <div className="mt-8 flex flex-wrap items-center gap-3"><Button asChild><Link href="/deployer">Héberger Cordée <ArrowRight aria-hidden="true" /></Link></Button><Button asChild variant="ghost"><Link href="/guide">Je suis invité <ArrowRight aria-hidden="true" /></Link></Button></div>
        <p className="mt-5 text-xs text-soft">Version 0.1 en test, fais une copie de ton coffre.</p>
      </div>
      <VaultPreview />
    </section>

    <section className="shell grid gap-8 border-t border-border py-10 md:grid-cols-3 md:gap-10 md:py-12" aria-label="Les trois promesses de Cordée">
      {[
        { Icon: Radio, title: "Vos notes, à jour", body: "Les changements arrivent en quelques secondes. Pas besoin de penser à synchroniser." },
        { Icon: GitMerge, title: "Chaque ligne compte", body: "Une fusion ligne à ligne qui conserve les deux versions si elles divergent. Sans rien perdre." },
        { Icon: Smartphone, title: "Même sur téléphone", body: "La même extension sur ordinateur, Android et iOS. Tes notes suivent le groupe." },
      ].map(({ Icon, title, body }) => <div key={title}><Icon className="mb-4 size-5 text-soft" aria-hidden="true" /><h2 className="text-base font-medium">{title}</h2><p className="mt-2 max-w-sm text-soft">{body}</p></div>)}
    </section>

    <section className="section" id="parcours"><div className="shell">
      <p className="eyebrow">Chacun son rôle</p><h2 className="section-title">Comment ça se passe</h2>
      <div className="mt-8 grid divide-y divide-border rounded-lg border border-input md:grid-cols-2 md:divide-x md:divide-y-0">
        <div className="p-6 sm:p-8"><span className="text-xs text-soft">Une seule personne par groupe</span><h3 className="mt-2 text-base font-semibold">Tu héberges</h3><ol className="mt-6 list-decimal space-y-4 pl-4 text-soft"><li>Tu loues ou utilises un petit serveur.</li><li>Tu y installes Cordée en suivant <Link href="/deployer" className="text-foreground underline underline-offset-4">le guide de déploiement</Link>.</li><li>Dans Obsidian, tu crées le coffre avec le code de création du serveur.</li><li>Tu cliques sur « Créer une invitation » dans les réglages de Cordée et tu envoies le lien à tes amis.</li></ol></div>
        <div className="p-6 sm:p-8"><span className="text-xs text-soft">Tous les autres membres du groupe</span><h3 className="mt-2 text-base font-semibold">Tu es invité</h3><p className="mt-4 text-soft">Tu n’installes aucun serveur.</p><ol className="mt-4 list-decimal space-y-4 pl-4 text-soft"><li>Tu ouvres le lien reçu.</li><li>Tu installes l’extension Cordée dans Obsidian.</li><li>Tu colles le lien et tu mets ton prénom. C’est tout.</li></ol><p className="mt-6 text-soft">Tes notes se synchronisent toutes seules, aussi sur téléphone.</p><Link href="/guide" className="mt-4 inline-flex items-center gap-2 text-foreground underline underline-offset-4">Voir le parcours en images <ArrowRight className="size-4" aria-hidden="true" /></Link></div>
      </div>
    </div></section>

    <section className="section" id="comment-ca-marche"><div className="shell">
      <p className="eyebrow">La mise en route</p><h2 className="section-title">Un serveur. Une extension. Vos amis.</h2>
      <div className="mt-10 grid gap-8 md:grid-cols-3 md:gap-12">
        {[
          ["01", "Héberge le serveur", "Lance Cordée sur un VPS avec Docker, ou directement avec Node. Ton serveur, tes fichiers."],
          ["02", "Installe l’extension", "Ajoute Cordée à Obsidian et crée ton premier coffre partagé avec le code de création."],
          ["03", "Envoie un lien", "Tes amis collent l’invitation dans Cordée. Ils ajoutent leur prénom et vous voilà réunis."],
        ].map(([n, title, body]) => <div key={n}><span className="font-mono text-xs text-muted-foreground">{n} <span className="ml-3 inline-block h-px w-12 align-middle bg-input" /></span><h3 className="mt-5 text-base font-medium">{title}</h3><p className="mt-2 text-soft">{body}</p></div>)}
      </div>
    </div></section>

    <section id="fonctionnalites" className="section"><div className="shell grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-16">
      <div><p className="eyebrow">Disponible en v0.1</p><h2 className="section-title">Le nécessaire<br className="hidden lg:block" /> pour partager.</h2><p className="mt-4 text-soft">Des fichiers Markdown ordinaires. Un serveur léger. Des garde-fous pour travailler ensemble.</p><span className="mt-6 inline-flex items-center gap-2 rounded-full border border-input px-3 py-1 text-xs text-soft"><Check className="size-3" aria-hidden="true" />Version en test</span></div>
      <table className="data-table"><caption className="sr-only">Fonctionnalités de Cordée version 0.1</caption><thead><tr><th scope="col">Fonction</th><th scope="col">Dans cette version</th></tr></thead><tbody>{features.map(([name, description]) => <tr key={name}><td className="font-medium">{name}</td><td>{description}</td></tr>)}</tbody></table>
    </div></section>

    <section className="section"><div className="shell"><p className="eyebrow">La suite de la cordée</p><h2 className="section-title">Une étape à la fois.</h2><p className="mt-4 text-soft">La feuille de route, sans promesse de date.</p>
      <div className="mt-10 grid gap-8 md:grid-cols-3">
        {[
          ["0.2", "Garder la main", "Restaurer une version de note, administrer les membres, les invitations et l’espace utilisé depuis le web, et retirer un membre."],
          ["0.3", "Écrire au même moment", "Éditer la même note à plusieurs en direct avec Yjs, en voyant les curseurs des autres."],
          ["0.4", "Chiffrer de bout en bout", "Activer un chiffrement optionnel pour que le serveur ne voie que des données chiffrées."],
        ].map(([version, title, body]) => <div className="border-t border-input pt-5" key={version}><span className="font-mono text-xs text-soft">{version} <span className="ml-2 text-muted-foreground">À venir</span></span><h3 className="mt-5 text-base font-medium">{title}</h3><p className="mt-2 text-soft">{body}</p></div>)}
      </div><p className="mt-8 text-xs text-soft">Également prévu : la publication dans le catalogue des extensions communautaires d’Obsidian.</p>
    </div></section>

    <section className="section"><div className="shell grid gap-10 lg:grid-cols-2 lg:gap-24">
      <div><p className="eyebrow">Sécurité & vie privée</p><h2 className="section-title">Vos notes restent<br />chez votre hébergeur.</h2><p className="mt-4 max-w-md text-soft">Pas de compte central, aucune télémétrie et aucun traceur. Le code est ouvert, le serveur est le vôtre.</p><p className="mt-4 max-w-md text-xs text-soft">En v0.1, l’hébergeur peut lire les notes. HTTPS protège le transport ; le chiffrement de bout en bout est prévu en 0.4.</p></div>
      <div className="space-y-7">{[
        { Icon: Server, title: "Auto-hébergé, de bout en bout", body: "Les fichiers et leur historique sont sur le serveur que vous choisissez. Vous gérez aussi ses sauvegardes." },
        { Icon: ShieldCheck, title: "Des accès cloisonnés", body: "Les jetons de 256 bits et les codes sont stockés hachés. Chaque jeton donne accès à un seul coffre." },
        { Icon: Globe, title: "Aucune collecte", body: "Cordée n’envoie ni statistiques d’utilisation ni notes à un service tiers. Les invitations se lisent ici dans le navigateur." },
      ].map(({ Icon, title, body }) => <div key={title} className="flex gap-4"><Icon className="mt-1 size-5 shrink-0 text-soft" aria-hidden="true" /><div><h3 className="text-base font-medium">{title}</h3><p className="mt-1 text-soft">{body}</p></div></div>)}</div>
    </div></section>

    <section className="section"><div className="shell grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-16"><div><p className="eyebrow">Avant de se lancer</p><h2 className="section-title">Quelques réponses.</h2></div><div>{faq.map(([q, a]) => <details key={q} className="group border-b border-border py-5 first:border-t"><summary className="flex items-center justify-between gap-5 font-medium">{q}<Plus className="size-4 shrink-0 text-soft transition-transform duration-150" aria-hidden="true" /></summary><p className="mt-4 max-w-2xl text-soft">{a}</p></details>)}</div></div></section>

    <section className="shell flex flex-col justify-between gap-8 border-t border-border py-14 sm:flex-row sm:items-center"><div><HardDrive className="mb-4 size-5 text-soft" aria-hidden="true" /><h2 className="text-base font-medium tracking-tight">Un petit serveur pour de grandes idées.</h2><p className="mt-2 text-soft">Environ 25 Mo de RAM. Aucune dépendance npm côté serveur.</p></div><Button asChild variant="outline"><Link href="/deployer">Lire le guide de déploiement <ArrowRight aria-hidden="true" /></Link></Button></section>
  </main>;
}
