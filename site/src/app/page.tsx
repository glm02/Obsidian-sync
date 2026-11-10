import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, GitMerge, LockKeyhole, Radio, Server, ShieldCheck, Smartphone } from "lucide-react";
import { BrandLogo, BrandStrip } from "@/components/brand-logo";
import { AudienceTabs } from "@/components/home/audience-tabs";
import { Faq } from "@/components/home/faq";
import { WorkspaceDemo } from "@/components/home/workspace-demo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { features } from "@/lib/home-content";
import { VERSION_EXTENSION } from "@/lib/extension";

export default function Home() {
  return <main id="contenu" className="landing">
    <section className="shell landing-hero">
      <span className="hero-badge"><BrandLogo brand="obsidian" className="size-3.5" /><span>Obsidian, en bonne compagnie.</span><span className="ml-1 size-1 rounded-full bg-primary" /></span>
      <h1>Tes notes.<br /><span>Le même horizon.</span></h1>
      <p className="hero-description">Ton coffre Obsidian. Tes amis. Ton serveur.</p>
      <div className="hero-actions"><Button asChild><Link href="/deployer" prefetch={false}>Héberger Cordée <ArrowRight aria-hidden="true" /></Link></Button><Button asChild variant="ghost"><Link href="/guide" prefetch={false}>Je suis invité <ArrowUpRight aria-hidden="true" /></Link></Button></div>
      <p className="hero-footnote">Version {VERSION_EXTENSION} en test, fais une copie de ton coffre. <Link href="/fonctionnalites#nouveautes" prefetch={false} className="underline underline-offset-4 hover:text-foreground">Quoi de neuf ?</Link></p>
      <div className="hero-workspace"><WorkspaceDemo /></div>
    </section>
    <BrandStrip />
    <section className="shell landing-section" id="fonctionnalites" data-reveal>
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Juste l’essentiel</p><h2 className="landing-heading mt-3">Ensemble. Sans friction.</h2></div><span className="text-xs text-muted-foreground">Du Markdown, et la liberté qui va avec.</span></div>
      <div className="feature-grid">
        <Card className="feature-card"><CardContent><Radio className="feature-icon" aria-hidden="true" /><div className="feature-visual sync-visual" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div><h3>Quelques secondes.</h3><p>Les changements arrivent tout seuls.</p></CardContent></Card>
        <Card className="feature-card"><CardContent><GitMerge className="feature-icon" aria-hidden="true" /><div className="feature-visual merge-visual" aria-hidden="true"><span>+ Ton idée</span><span>+ La sienne</span><Check className="size-3" /></div><h3>Chaque ligne compte.</h3><p>La fusion conserve vos deux versions.</p></CardContent></Card>
        <Card className="feature-card"><CardContent><Smartphone className="feature-icon" aria-hidden="true" /><div className="feature-visual device-visual" aria-hidden="true"><span className="mini-desktop"><i /><i /><i /></span><span className="mini-phone"><i /><i /></span></div><h3>Au creux de la main.</h3><p>Ordinateur. Android. iOS.</p></CardContent></Card>
      </div>
      <details className="feature-details"><summary className="flex items-center justify-between gap-4 py-5 text-xs text-soft hover:text-foreground">Le tableau de la première version<ChevronDown className="size-3.5" aria-hidden="true" /></summary><table className="data-table"><caption className="sr-only">Fonctionnalités de la version 0.1</caption><thead><tr><th scope="col">Fonction</th><th scope="col">Détail</th></tr></thead><tbody>{features.map(([name, description]) => <tr key={name}><td>{name}</td><td>{description}</td></tr>)}</tbody></table></details><p className="mt-4 text-xs"><Link href="/fonctionnalites" prefetch={false} className="text-soft underline underline-offset-4 hover:text-foreground">Toutes les fonctionnalités, à jour, et les nouveautés de chaque version</Link></p>
    </section>
    <section className="shell landing-section" data-reveal><AudienceTabs /></section>
    <section className="shell landing-section privacy-section" data-reveal>
      <div className="privacy-mark"><LockKeyhole className="size-6" aria-hidden="true" /></div>
      <div><p className="eyebrow">À vous, vraiment.</p><h2 className="landing-heading mt-3">Vos idées restent chez vous.</h2><div className="privacy-promises"><span><Server />Auto-hébergé</span><span><ShieldCheck />Jetons hachés</span><span><Check />Aucune télémétrie</span></div><p className="mt-5 max-w-md text-xs leading-6 text-muted-foreground">En v0.1, l’hébergeur peut lire les notes. Le chiffrement de bout en bout est prévu en 0.4.</p></div>
      <div className="privacy-spec"><span className="font-mono text-[40px] leading-none tracking-[-.06em]">~25<span className="ml-1 text-base text-soft">Mo</span></span><p className="mt-3 text-xs text-soft">de RAM côté serveur</p><p className="mt-1 text-[10px] text-muted-foreground">0 dépendance npm.</p></div>
    </section>
    <section className="shell landing-section" data-reveal><div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start"><div><p className="eyebrow">La suite</p><h2 className="landing-heading mt-3">Un pas après l’autre.</h2></div><div className="roadmap-list">{[["0.2", "Restaurer & administrer", "Historique, membres, invitations."], ["0.3", "Écrire en direct", "Une même note, plusieurs curseurs."], ["0.4", "Chiffrer de bout en bout", "En option, côté extension."]].map(([version, title, text]) => <div key={version}><span className="roadmap-version">{version}</span><div><h3 className="text-sm">{title}</h3><p className="mt-1 text-xs text-muted-foreground">{text}</p></div><span className="ml-auto text-[10px] text-muted-foreground">À venir</span></div>)}</div></div><p className="mt-5 text-[10px] text-muted-foreground sm:text-right">Également prévu : le catalogue communautaire Obsidian. Sans calendrier annoncé.</p></section>
    <section className="shell landing-section landing-faq" data-reveal><div><p className="eyebrow">Avant de partir</p><h2 className="landing-heading mt-3">Les questions simples.</h2><a href="https://github.com/glm02/Obsidian-sync" className="mt-6 inline-flex items-center gap-2 text-xs text-soft hover:text-foreground"><BrandLogo brand="github" className="size-3.5" />Le code est ouvert <ArrowUpRight className="size-3" /></a></div><Faq /></section>
  </main>;
}