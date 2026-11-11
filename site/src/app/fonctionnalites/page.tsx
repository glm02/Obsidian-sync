import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowRight, CalendarDays, Command, FolderTree, PanelLeft, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { groupes, ouTrouver, versions, VERSION_EXTENSION } from "@/lib/extension";

export const metadata: Metadata = {
  title: "Fonctionnalités et nouveautés",
  description: "Tout ce que fait l’extension Cordée, où le trouver dans Obsidian, et ce qui change à chaque version.",
};

const icones = { semaine: CalendarDays, synchro: RefreshCw, fichiers: FolderTree, groupe: Users, securite: ShieldCheck };
const iconesAcces = [PanelLeft, Command, Activity];

export default function FonctionnalitesPage() {
  return <main id="contenu" className="shell pb-16">
    <section className="guide-hero">
      <span className="hero-badge">Extension Cordée · version {VERSION_EXTENSION}</span>
      <h1 className="mt-6 text-[40px] font-medium leading-tight tracking-[-.055em] sm:text-[64px]">Ce que fait Cordée.<br /><span className="text-soft">Et ce qui a changé.</span></h1>
      <p className="mt-5 max-w-xl text-sm text-soft">Tout ce que l’extension sait faire, expliqué simplement, puis les nouveautés version par version.</p>
      <nav aria-label="Sur cette page" className="mt-8 flex flex-wrap gap-2 text-xs">
        {groupes.map((g) => <a key={g.id} href={`#${g.id}`} className="rounded-full border border-border px-3 py-1.5 text-soft hover:border-[#515151] hover:text-foreground">{g.titre}</a>)}
        <a href="#nouveautes" className="rounded-full border border-border px-3 py-1.5 text-soft hover:border-[#515151] hover:text-foreground">Nouveautés</a>
        <a href="#mettre-a-jour" className="rounded-full border border-border px-3 py-1.5 text-soft hover:border-[#515151] hover:text-foreground">Mettre à jour</a>
      </nav>
    </section>

    <section className="landing-section" data-reveal>
      <p className="eyebrow">Dans Obsidian</p>
      <h2 className="landing-heading mt-3">Où trouver quoi.</h2>
      <div className="feature-grid mt-8">
        {ouTrouver.map((o, i) => { const Icone = iconesAcces[i]; return <Card key={o.titre} className="feature-card"><CardContent><Icone className="feature-icon" aria-hidden="true" /><h3 className="sm:mt-4">{o.titre}</h3><p>{o.texte}</p></CardContent></Card>; })}
      </div>
    </section>

    {groupes.map((g) => {
      const Icone = icones[g.id as keyof typeof icones];
      return <section key={g.id} id={g.id} className="landing-section scroll-mt-24" data-reveal>
        <div className="flex items-center gap-3"><Icone className="feature-icon" aria-hidden="true" /><p className="eyebrow">{g.titre}</p></div>
        <h2 className="landing-heading mt-3">{g.resume}</h2>
        <table className="data-table mt-6">
          <tbody>{g.fonctions.map((f) => <tr key={f.titre}><td className="text-sm font-medium">{f.titre}</td><td className="text-sm leading-6">{f.texte}</td></tr>)}</tbody>
        </table>
      </section>;
    })}

    <section id="nouveautes" className="landing-section scroll-mt-24" data-reveal>
      <p className="eyebrow">Nouveautés</p>
      <h2 className="landing-heading mt-3">Version après version.</h2>
      <ol className="mt-8 space-y-8">
        {versions.map((v, i) => <li key={v.version} className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
          <div className="flex items-start gap-2"><span className="roadmap-version">{v.version}</span>{i === 0 && <span className="rounded-full border border-[#4124fb] px-2 py-0.5 text-[10px] text-foreground">actuelle</span>}</div>
          <div><h3 className="text-sm font-medium">{v.titre}</h3><ul className="mt-2 space-y-1.5 text-sm leading-6 text-soft">{v.points.map((p) => <li key={p} className="flex gap-2"><span aria-hidden="true" className="text-muted-foreground">–</span><span>{p}</span></li>)}</ul></div>
        </li>)}
      </ol>
    </section>

    <section id="mettre-a-jour" className="landing-section scroll-mt-24 border-b-0" data-reveal>
      <p className="eyebrow">Mettre à jour</p>
      <h2 className="landing-heading mt-3">Garde la même version que tes amis.</h2>
      <div className="mt-6 max-w-2xl space-y-4 text-sm leading-6 text-soft">
        <p><strong className="text-foreground">Installée depuis le catalogue d’Obsidian :</strong> Réglages → Modules complémentaires → « Vérifier les mises à jour », puis « Mettre à jour » sur Cordee.</p>
        <p><strong className="text-foreground">Installée avec BRAT :</strong> palette de commandes → « BRAT: Check for updates to all beta plugins ».</p>
        <p><strong className="text-foreground">« Échec de l’installation » ?</strong> Une nouvelle version met parfois une minute à être disponible. Réessaie, ou installe l’archive ZIP de la dernière version depuis la page d’installation ; tes réglages et ton coffre sont conservés.</p>
        <p>Après une mise à jour, désactive puis réactive Cordée (ou redémarre Obsidian) pour que la nouvelle version tourne.</p>
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild><Link prefetch={false} href="/installer">Installer ou mettre à jour <ArrowRight aria-hidden="true" /></Link></Button>
      </div>
    </section>
  </main>;
}
