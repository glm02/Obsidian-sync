"use client";

import Link from "next/link";
import { ArrowUpRight, Box, KeyRound, Link2, Server, UserRound } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function AudienceTabs() {
  return <Tabs defaultValue="invite" className="audience-tabs">
    <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end"><div><p className="eyebrow">Comment ça se passe</p><h2 className="landing-heading mt-3">Chacun sa place.</h2></div><TabsList aria-label="Choisir votre rôle"><TabsTrigger value="invite">Tu es invité</TabsTrigger><TabsTrigger value="hote">Tu héberges</TabsTrigger></TabsList></div>
    <TabsContent value="invite" className="mt-8"><div className="audience-steps">{[
      { Icon: Box, title: "L’extension.", text: "Installe Cordée dans Obsidian." },
      { Icon: Link2, title: "Le lien.", text: "Colle l’invitation reçue de ton ami." },
      { Icon: UserRound, title: "Ton prénom.", text: "Rejoins. Tes notes arrivent toutes seules." },
    ].map(({ Icon, title, text }, i) => <div key={title}><div className="flex items-center justify-between"><Icon className="size-5 text-soft" aria-hidden="true" /><span className="font-mono text-[10px] text-muted-foreground">0{i + 1}</span></div><h3 className="mt-5 font-medium">{title}</h3><p className="mt-2 text-xs text-soft">{text}</p></div>)}</div><div className="mt-5 flex flex-col justify-between gap-3 text-xs sm:flex-row"><p className="text-soft">Aucun serveur à installer. Même sur téléphone.</p><Link href="/guide" prefetch={false} className="inline-flex items-center gap-1.5 hover:text-soft">Le guide invité <ArrowUpRight className="size-3" /></Link></div></TabsContent>
    <TabsContent value="hote" className="mt-8"><div className="audience-steps">{[
      { Icon: Server, title: "Un serveur.", text: "Loue un petit VPS ou utilise le tien." },
      { Icon: KeyRound, title: "Un coffre.", text: "Installe Cordée. Crée le coffre avec ton code." },
      { Icon: Link2, title: "Une invitation.", text: "Dans Obsidian : « Créer une invitation ». Envoie le lien." },
    ].map(({ Icon, title, text }, i) => <div key={title}><div className="flex items-center justify-between"><Icon className="size-5 text-soft" aria-hidden="true" /><span className="font-mono text-[10px] text-muted-foreground">0{i + 1}</span></div><h3 className="mt-5 font-medium">{title}</h3><p className="mt-2 text-xs text-soft">{text}</p></div>)}</div><div className="mt-5 flex flex-col justify-between gap-3 text-xs sm:flex-row"><p className="text-soft">Une seule personne héberge pour tout le groupe.</p><Link href="/deployer" prefetch={false} className="inline-flex items-center gap-1.5 hover:text-soft">Le guide de déploiement <ArrowUpRight className="size-3" /></Link></div></TabsContent>
  </Tabs>;
}
