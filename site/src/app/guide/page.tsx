import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowRight, Check, FileText, Folder, Link2, Settings2 } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export const metadata: Metadata = {
  title: "Je suis invité — le guide",
  description: "Un lien, l’extension Cordée et ton prénom. Rejoins tes amis dans Obsidian, sans installer de serveur.",
};

function GuideStep({ number, title, description, children }: { number: string; title: string; description: React.ReactNode; children: React.ReactNode }) {
  return <Card className="guide-step" data-reveal><CardContent><div className="flex items-center justify-between"><span className="eyebrow">{number} / Le parcours invité</span><span className="text-[10px] text-muted-foreground">Aperçu</span></div><h2 className="mt-4 text-base font-medium">{title}</h2><p className="mt-2 text-xs leading-6 text-soft">{description}</p><div className="guide-screen mt-6" aria-hidden="true">{children}</div></CardContent></Card>;
}

export default function GuidePage() {
  return <main id="contenu" className="shell pb-16">
    <section className="guide-hero"><span className="hero-badge"><BrandLogo brand="obsidian" className="size-3.5" />Le guide invité</span><h1 className="mt-6 text-[40px] font-medium leading-tight tracking-[-.055em] sm:text-[64px]">Un lien.<br /><span className="text-soft">Et te voilà avec nous.</span></h1><p className="mt-5 text-sm text-soft">Aucun serveur à installer. Juste Obsidian et Cordée.</p><Button asChild className="mt-7"><a href="#les-etapes">Rejoindre un coffre <ArrowDown aria-hidden="true" /></a></Button><p className="mt-5 text-[11px] text-muted-foreground">Version 0.1 en test : fais une copie de ton coffre.</p></section>
    <div id="les-etapes" className="guide-grid">
      <GuideStep number="01" title="Ouvre l’invitation." description="Ton ami t’envoie un lien. Garde-le pour ouvrir Cordée après l’installation.">
        <div className="flex items-center gap-2 border-b border-border pb-4 text-[11px] text-soft"><Link2 className="size-3.5" />Un message de ton ami</div><p className="mt-5 text-sm font-medium">On partage nos notes ?</p><p className="mt-3 break-all rounded-md border border-input bg-background p-3 font-mono text-[10px] leading-6 text-soft">cordee.vercel.app/rejoindre<br />#serveur=…&amp;code=ABCD-EFGH-JKLM</p>
      </GuideStep>
      <GuideStep number="02" title="Ajoute Cordée." description={<>Pars d’un coffre vide. <Link prefetch={false} href="/installer" className="text-foreground underline underline-offset-4">Installe avec BRAT</Link> et active l’extension.</>}>
        <div className="flex items-center gap-2 border-b border-border pb-4 text-[11px] text-soft"><Settings2 className="size-3.5" />Obsidian · Extensions</div><div className="mt-5 flex items-center justify-between"><div><p className="text-sm">Cordée</p><p className="mt-1 text-[10px] text-muted-foreground">Installation via BRAT</p></div><span className="flex h-5 w-9 items-center justify-end rounded-full bg-primary px-0.5"><span className="size-4 rounded-full bg-white" /></span></div><p className="mt-5 flex items-center gap-2 text-[11px] text-soft"><Check className="size-3" />Extension activée</p>
      </GuideStep>
      <GuideStep number="03" title="Ouvre l’invitation dans Obsidian." description="Clique sur « Ouvrir dans Obsidian », ajoute ton prénom et confirme. Aucun code de création à saisir.">
        <div className="border-b border-border pb-4 text-[11px] text-soft">Obsidian · Réglages Cordée</div><div className="mt-4 rounded-md border border-input px-3 py-2 font-mono text-[10px] text-soft">https://cordee.vercel.app/rejoindre#…</div><div className="mt-2 rounded-md border border-input px-3 py-2 text-[11px] text-soft">Ton prénom</div><span className="mt-4 inline-flex items-center gap-2 text-[11px]">Rejoindre <ArrowRight className="size-3" /></span>
      </GuideStep>
      <GuideStep number="04" title="Les notes arrivent." description="Lis, écris, partage. La synchronisation est automatique, aussi sur téléphone.">
        <div className="flex items-center justify-between border-b border-border pb-4 text-[11px]"><span className="flex items-center gap-2"><Folder className="size-3.5 text-soft" />Notre coffre</span><span className="flex items-center gap-1 text-muted-foreground"><Check className="size-3" />À jour</span></div><div className="mt-5 space-y-4 text-[11px] text-soft">{["Les idées.md", "Ressources.md", "Pour la suite.md"].map(note => <p className="flex items-center gap-2" key={note}><FileText className="size-3.5" />{note}</p>)}</div>
      </GuideStep>
    </div>
    <section className="landing-section landing-faq" data-reveal><div><p className="eyebrow">Bon à savoir</p><h2 className="landing-heading mt-3">La place de chacun.</h2></div><Accordion type="single" collapsible>
      <AccordionItem value="fusion"><AccordionTrigger>Et si on modifie la même note ?</AccordionTrigger><AccordionContent>Cordée réunit les changements ligne à ligne. Si la même ligne change différemment, les deux versions sont gardées à la suite et une notification te prévient. Rien n’est perdu. Les curseurs en direct viendront en 0.3.</AccordionContent></AccordionItem>
      <AccordionItem value="partage"><AccordionTrigger>Qui voit quoi ?</AccordionTrigger><AccordionContent>Les membres voient le coffre partagé. Exclus tes dossiers privés avec « Dossiers non partagés » avant la synchronisation. Les réglages Obsidian (.obsidian) ne sont jamais partagés.</AccordionContent></AccordionItem>
      <AccordionItem value="historique"><AccordionTrigger>Et l’historique ?</AccordionTrigger><AccordionContent>L’hébergeur conserve toutes les versions et peut lire les notes en v0.1. Choisis une personne de confiance. La restauration dans l’extension arrive en 0.2.</AccordionContent></AccordionItem>
      <AccordionItem value="invitation"><AccordionTrigger>Mon lien ne marche plus.</AccordionTrigger><AccordionContent>Demande un nouveau lien à ton ami. Une invitation expire après 7 jours ou 5 utilisations.</AccordionContent></AccordionItem>
    </Accordion></section>
  </main>;
}
