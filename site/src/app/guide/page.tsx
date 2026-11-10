import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowRight, Check, FileText, Folder, Link2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Je suis invité — le guide",
  description: "Rejoins le coffre Obsidian de tes amis en quatre étapes, sans installer de serveur. Un lien, l’extension Cordée et ton prénom suffisent.",
};

function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  return <figure className="min-w-0 overflow-hidden rounded-lg border border-input bg-[#191919]">
    <div aria-hidden="true" className="flex items-center gap-2 border-b border-border px-4 py-3 text-xs text-soft"><span className="size-1.5 rounded-full bg-primary" />{title}</div>
    <div aria-hidden="true" className="p-5 sm:p-6">{children}</div>
    <figcaption className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground">Maquette illustrative · {title}</figcaption>
  </figure>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mt-4"><div className="mb-2 text-xs text-soft">{label}</div><div className="break-all rounded-md border border-input px-3 py-2.5 text-xs text-foreground">{children}</div></div>;
}

function MockAction({ children }: { children: React.ReactNode }) {
  return <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-input bg-secondary px-4 py-2 text-xs text-foreground">{children}</div>;
}

export default function GuidePage() {
  return <main id="contenu">
    <section className="shell pb-14 pt-14 sm:pb-20 sm:pt-20"><div className="max-w-2xl">
      <p className="eyebrow">Le guide des amis</p><h1 className="mt-4 text-[40px] font-medium leading-tight tracking-[-.045em] sm:text-[56px]">Je suis invité.</h1>
      <p className="mt-5 max-w-xl text-[15px] leading-7 text-soft">Tu n’as aucun serveur à installer. Ton ami s’en occupe. De ton côté, il te faut Obsidian, l’extension Cordée et le lien qu’il t’a envoyé.</p>
      <Button asChild className="mt-8"><a href="#les-etapes">Rejoindre un coffre <ArrowDown aria-hidden="true" /></a></Button>
      <p className="mt-5 text-xs text-soft">Sur ordinateur, Android et iOS. Version 0.1 en test : fais une copie de ton coffre.</p>
    </div></section>

    <div className="shell" id="les-etapes">
      <section data-reveal className="grid items-center gap-8 border-t border-border py-12 md:grid-cols-2 md:gap-16 md:py-16">
        <div><p className="eyebrow">01 / Le lien reçu</p><h2 className="mt-4 text-base font-semibold">Ton ami t’invite.</h2><p className="mt-4 text-soft">Il t’envoie un lien dans votre conversation habituelle. Ouvre-le : tu verras l’adresse du serveur et le code d’invitation. Tu n’as rien à saisir sur ce site.</p><p className="mt-4 text-soft">Garde ce lien sous la main. Le bouton « Copier le lien » copie l’invitation entière pour la suite.</p></div>
        <Screen title="Une invitation reçue"><div className="flex items-center gap-2 text-xs text-soft"><Link2 className="size-4" />Un message de ton ami</div><div className="mt-5 rounded-lg border border-border p-4"><p className="font-medium">On partage nos notes ?</p><p className="mt-2 text-xs text-soft">Voici ton invitation pour notre coffre Cordée.</p><div className="mt-4 break-all rounded-md border border-input p-3 font-mono text-[11px] text-soft">https://cordee.vercel.app/rejoindre<br />#serveur=…&amp;code=ABCD-EFGH-JKLM</div></div><MockAction>Ouvrir le lien <ArrowRight className="size-3" /></MockAction></Screen>
      </section>

      <section data-reveal className="grid items-center gap-8 border-t border-border py-12 md:grid-cols-2 md:gap-16 md:py-16">
        <div><p className="eyebrow">02 / Une petite installation</p><h2 className="mt-4 text-base font-semibold">Ajoute Cordée à Obsidian.</h2><p className="mt-4 text-soft">Installe Obsidian si tu ne l’as pas encore, puis crée de préférence un coffre vide. Ce sera le dossier dans lequel les notes du groupe arriveront.</p><p className="mt-4 text-soft">Ajoute les deux fichiers de l’extension dans <code className="break-all font-mono text-xs text-foreground">.obsidian/plugins/cordee/</code>, puis active Cordée dans les extensions communautaires.</p><Link prefetch={false} href="/deployer#extension" className="mt-5 inline-flex items-center gap-2 text-foreground underline underline-offset-4">Les fichiers et les étapes d’installation <ArrowRight className="size-4" aria-hidden="true" /></Link></div>
        <Screen title="Obsidian · Extensions communautaires"><div className="flex items-center gap-2 text-xs text-soft"><Settings2 className="size-4" />Extensions installées</div><div className="mt-6 flex items-center justify-between gap-4 rounded-lg border border-input p-4"><div><p className="font-medium">Cordée</p><p className="mt-1 text-xs text-soft">Partager un coffre entre amis</p></div><span className="flex h-5 w-9 shrink-0 items-center justify-end rounded-full bg-primary px-0.5"><span className="size-4 rounded-full bg-white" /></span></div><p className="mt-4 flex items-center gap-2 text-xs text-soft"><Check className="size-3.5" />Extension activée</p><div className="mt-6 rounded-md border border-border px-4 py-3 font-mono text-[11px] text-soft">cordee/<br /><span className="pl-4">manifest.json</span><br /><span className="pl-4">main.js</span></div></Screen>
      </section>

      <section data-reveal id="rejoindre" className="grid items-center gap-8 border-t border-border py-12 md:grid-cols-2 md:gap-16 md:py-16">
        <div><p className="eyebrow">03 / Le lien et ton prénom</p><h2 className="mt-4 text-base font-semibold">Rejoins le coffre de ton ami.</h2><p className="mt-4 text-soft">Ouvre <strong className="font-medium text-foreground">Réglages → Cordée → Rejoindre</strong>. Colle le lien complet de l’invitation, puis renseigne ton prénom pour que tes amis sachent qui a modifié une note.</p><p className="mt-4 text-soft">Clique sur « Rejoindre ». Tu n’as pas besoin du code de création : il sert seulement à la personne qui héberge.</p></div>
        <Screen title="Obsidian · Réglages Cordée"><p className="text-sm font-medium">Rejoindre un coffre</p><Field label="Lien d’invitation"><span className="font-mono text-[11px]">https://cordee.vercel.app/rejoindre#…</span></Field><Field label="Ton prénom"><span className="text-soft">Ton prénom</span></Field><MockAction>Rejoindre <ArrowRight className="size-3" /></MockAction><p className="mt-4 text-[11px] text-soft">Visible par les autres membres.</p></Screen>
      </section>

      <section data-reveal className="grid items-center gap-8 border-t border-border py-12 md:grid-cols-2 md:gap-16 md:py-16">
        <div><p className="eyebrow">04 / Vous voilà ensemble</p><h2 className="mt-4 text-base font-semibold">Les notes arrivent toutes seules.</h2><p className="mt-4 text-soft">Les fichiers du groupe apparaissent dans ton coffre Obsidian. Tu peux les lire et les modifier comme tes notes habituelles.</p><p className="mt-4 text-soft">Les changements de tes amis arrivent en quelques secondes. Les tiens leur sont envoyés automatiquement, aussi sur téléphone.</p></div>
        <Screen title="Obsidian · Notre coffre"><div className="flex items-center justify-between gap-3 text-xs"><span className="flex items-center gap-2"><Folder className="size-4 text-soft" />Notre coffre</span><span className="flex items-center gap-1 text-soft"><Check className="size-3.5" />Synchronisé</span></div><div className="my-5 space-y-3 border-y border-border py-4 text-xs text-soft"><p className="flex items-center gap-2"><FileText className="size-3.5" />Les idées.md</p><p className="flex items-center gap-2"><FileText className="size-3.5" />Ressources.md</p><p className="flex items-center gap-2"><FileText className="size-3.5" />Pour la suite.md</p></div><p className="text-base font-medium">Nos idées pour la suite</p><p className="mt-3 border-l-2 border-primary pl-3 text-xs leading-6 text-soft">Une note commencée ensemble.<br />Une nouvelle idée ajoutée par un ami.</p></Screen>
      </section>
    </div>

    <section className="section"><div className="shell grid gap-8 md:grid-cols-[1fr_1.2fr] md:gap-16"><div><p className="eyebrow">On écrit ensemble</p><h2 className="section-title">Et si deux personnes modifient la même note ?</h2></div><div className="space-y-4 text-soft"><p>Cordée compare les lignes. Si tu ajoutes une idée en haut et qu’un ami corrige un paragraphe plus bas, les deux changements sont réunis dans la même note.</p><p>Si vous changez la même ligne de deux façons différentes, rien n’est perdu : les deux versions sont gardées à la suite. Une notification te le signale et vous pouvez choisir ensemble la bonne formulation.</p><p>L’édition en direct avec les curseurs de chacun est prévue plus tard. Aujourd’hui, Cordée synchronise et fusionne vos notes.</p></div></div></section>
    <section className="section"><div className="shell grid gap-8 md:grid-cols-[1fr_1.2fr] md:gap-16"><div><p className="eyebrow">Les limites du partage</p><h2 className="section-title">Qui voit quoi ?</h2></div><dl className="divide-y divide-border"><div className="pb-5"><dt className="font-medium">Tes amis voient le coffre partagé.</dt><dd className="mt-2 text-soft">Ses notes et ses fichiers sont partagés avec les membres qui l’ont rejoint.</dd></div><div className="py-5"><dt className="font-medium">Tes dossiers privés peuvent rester chez toi.</dt><dd className="mt-2 text-soft">Ajoute-les au réglage « Dossiers non partagés » de Cordée avant la synchronisation. Ils restent hors du partage.</dd></div><div className="py-5"><dt className="font-medium">L’hébergeur garde l’historique.</dt><dd className="mt-2 text-soft">Son serveur conserve toutes les versions des fichiers. En v0.1, il peut lire les notes : choisis une personne de confiance.</dd></div><div className="pt-5"><dt className="font-medium">Tes réglages Obsidian restent à toi.</dt><dd className="mt-2 text-soft">Le dossier .obsidian n’est jamais partagé. Tes réglages et ceux de tes amis restent indépendants.</dd></div></dl></div></section>
    <div className="shell border-t border-border py-10 text-xs text-soft">Tu as un souci avec ton invitation ? Demande un nouveau lien à ton ami. Il expire après 7 jours ou 5 utilisations.</div>
  </main>;
}
