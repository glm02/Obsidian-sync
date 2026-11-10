"use client";

import { useState } from "react";
import { ArrowDownUp, Check, ChevronRight, FileText, Folder, GitMerge, History, Link2, LockKeyhole, MoreHorizontal, Plus, RotateCcw, UserPlus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import { BrandLogo } from "@/components/brand-logo";

const exampleLink = "https://cordee.vercel.app/rejoindre#serveur=https%3A%2F%2Fcordee.exemple.fr&code=ABCD-EFGH-JKLM";

function DemoInvite() {
  return <Dialog><DialogTrigger asChild><Button variant="outline" size="sm" className="h-8 gap-1.5 px-3 text-[11px]"><UserPlus aria-hidden="true" />Inviter</Button></DialogTrigger><DialogContent>
    <span className="flex size-10 items-center justify-center rounded-lg border border-input"><Link2 className="size-4" /></span>
    <DialogTitle className="text-xl font-medium tracking-tight">Un lien. Et vous voilà ensemble.</DialogTitle>
    <DialogDescription className="text-sm text-soft">Ceci est un exemple. Dans Obsidian, « Créer une invitation » génère le lien de votre coffre.</DialogDescription>
    <p className="break-all rounded-lg border border-input bg-secondary p-4 font-mono text-[11px] leading-6 text-soft">{exampleLink}</p>
    <CopyButton text={exampleLink} label="Copier l’exemple" />
  </DialogContent></Dialog>;
}

export function WorkspaceDemo() {
  const [note, setNote] = useState("idees");
  const [modified, setModified] = useState(false);
  return <div className="workspace-demo" aria-label="Démonstration interactive de Cordée">
    <Tabs defaultValue="notes">
      <div className="demo-toolbar">
        <div className="flex items-center gap-3"><BrandLogo brand="obsidian" className="size-4" /><span className="text-xs font-medium">Notre coffre</span><span className="demo-label">Démo</span></div>
        <TabsList aria-label="Explorer la démonstration"><TabsTrigger value="notes">Notes</TabsTrigger><TabsTrigger value="fusion">Fusion</TabsTrigger><TabsTrigger value="activite">Activité</TabsTrigger></TabsList>
        <div className="demo-invite"><DemoInvite /></div>
      </div>

      <TabsContent value="notes" className="demo-content">
        <aside className="demo-sidebar" aria-label="Notes de la démonstration"><p className="mb-5 flex items-center gap-2 text-[10px] text-muted-foreground"><ChevronRight className="size-3" />LE COFFRE</p>{[
          ["idees", "Les idées.md"], ["ressources", "Ressources.md"],
        ].map(([id, label]) => <button key={id} type="button" onClick={() => setNote(id)} className={`demo-file ${note === id ? "is-active" : ""}`} aria-pressed={note === id}><FileText className="size-3.5" />{label}</button>)}<span className="mt-4 flex items-center gap-2 px-2 text-xs text-muted-foreground"><Folder className="size-3.5" />Archives</span><div className="demo-sidebar-bottom"><LockKeyhole className="size-3" />Votre serveur</div></aside>
        <div className="demo-editor">
          <div className="mb-8 flex items-center justify-between text-[10px] text-muted-foreground"><span>NOTES <span className="mx-2">/</span> {note === "idees" ? "LES IDÉES" : "RESSOURCES"}</span><MoreHorizontal className="size-4" aria-hidden="true" /></div>
          {note === "idees" ? <><p className="mb-5 text-[28px] font-medium leading-tight tracking-[-.04em] sm:text-[34px]">Les bonnes idées<br />se partagent.</p><p className="text-xs leading-7 text-soft">Un point de départ pour la suite.<br />Et de la place pour les idées de chacun.</p><div className="mt-6 space-y-3 text-xs text-soft"><p className="flex items-center gap-2"><span className="demo-checkbox"><Check /></span>Rassembler nos découvertes</p><p className="flex items-center gap-2"><span className="demo-checkbox" />Construire quelque chose ensemble</p></div>{modified && <div className="demo-addition mt-5" role="status"><span className="font-mono text-primary">+</span> Une nouvelle idée. Ajoutée par un ami.</div>}</> : <><p className="mb-5 text-[28px] font-medium tracking-tight">Tout au même endroit.</p><p className="text-xs leading-7 text-soft">Notes, liens, images et PDF.<br />Les ressources du groupe, dans votre coffre.</p><div className="mt-6 flex items-center gap-3 rounded-lg border border-border p-4 text-xs text-soft"><FileText className="size-4" />Notre prochaine idée.md</div></>}
          <button type="button" onClick={() => { setNote("idees"); setModified(!modified); }} className="demo-simulate">{modified ? <RotateCcw className="size-3" /> : <Plus className="size-3" />}{modified ? "Réinitialiser" : "Simuler une modification"}</button>
        </div>
        <aside className="demo-presence"><p className="text-[10px] text-muted-foreground">LA CORDÉE</p><div className="mt-5 flex -space-x-2"><span className="demo-avatar">M</span><span className="demo-avatar">A</span></div><p className="mt-3 text-xs">Vous et un ami</p><p className="mt-1 text-[10px] text-muted-foreground">Un même coffre.</p><div className="mt-10 border-t border-border pt-5"><ArrowDownUp className="mb-3 size-4 text-muted-foreground" /><p className="text-xs">{modified ? "Modification reçue" : "Tout est à jour"}</p><p className="mt-1 text-[10px] text-muted-foreground">{modified ? "La nouvelle ligne est conservée." : "Vos fichiers se retrouvent."}</p></div></aside>
      </TabsContent>

      <TabsContent value="fusion" className="demo-fusion"><div><span className="eyebrow">Deux idées. Une note.</span><p className="mt-4 text-[28px] font-medium leading-tight tracking-tight">Rien ne se perd<br />en chemin.</p><p className="mt-4 max-w-xs text-xs leading-6 text-soft">Deux modifications sur la même ligne ? Cordée garde les deux versions.</p></div><div className="w-full max-w-sm rounded-lg border border-input bg-background p-5"><div className="flex items-center gap-2 border-b border-border pb-4 text-xs"><GitMerge className="size-4 text-soft" />Les idées.md<span className="ml-auto text-[10px] text-muted-foreground">Fusion</span></div><div className="space-y-3 py-5 font-mono text-[11px] text-soft"><p><span className="mr-4 text-muted-foreground">1</span># Nos idées</p><p className="rounded bg-primary/10 px-2 py-1"><span className="mr-3 text-foreground">+</span>Explorer une première piste.</p><p className="rounded bg-primary/10 px-2 py-1"><span className="mr-3 text-foreground">+</span>Essayer une autre approche.</p></div><p className="flex items-center gap-2 border-t border-border pt-4 text-[10px] text-soft"><Check className="size-3" />Les deux versions sont conservées.</p></div></TabsContent>

      <TabsContent value="activite" className="demo-activity"><div className="mb-6 flex items-center gap-3"><History className="size-5 text-soft" /><div><p className="text-base font-medium">Le fil de vos idées.</p><p className="mt-1 text-xs text-muted-foreground">Qui a changé quoi, simplement.</p></div></div>{[
        ["Un ami", "a modifié", "Les idées.md", "À l’instant"], ["Vous", "avez ajouté", "Ressources.md", "Il y a 2 min"], ["Un ami", "a rejoint", "Notre coffre", "Il y a 5 min"],
      ].map(([who, action, file, time], index) => <div className="flex items-center gap-4 border-t border-border py-4" key={file}><span className="demo-avatar shrink-0">{index === 1 ? "M" : "A"}</span><div className="min-w-0 flex-1 text-xs"><p>{who} <span className="text-soft">{action}</span></p><p className="mt-1 truncate text-muted-foreground">{file}</p></div><span className="text-[10px] text-muted-foreground">{time}</span></div>)}</TabsContent>
      <div className="demo-statusbar"><span className="flex items-center gap-2"><span className="size-1 rounded-full bg-primary" />{modified ? "Modification synchronisée" : "Synchronisé"}</span><span>Exemple interactif · Données fictives</span></div>
    </Tabs>
  </div>;
}
