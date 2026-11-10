import type { Metadata } from "next";
import { InstallPlugin } from "@/components/install-plugin";

export const metadata: Metadata = { title: "Installer Cordée", description: "Installe Cordée avec BRAT, sans télécharger les fichiers un par un, puis ouvre ton invitation directement dans Obsidian." };

export default function InstallerPage() {
  return <main id="contenu" className="shell py-14 sm:py-20"><div className="mx-auto max-w-2xl"><p className="eyebrow">Sur ordinateur et mobile</p><h1 className="mt-4 text-4xl font-medium tracking-tight sm:text-5xl">Installe. Rejoins. Écris.</h1><div className="mt-8"><InstallPlugin /></div><p className="mt-8 text-xs text-muted-foreground">Version 0.1 en test. Commence avec un coffre vide ; garde des sauvegardes de tes notes.</p></div></main>;
}
