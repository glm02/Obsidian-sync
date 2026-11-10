import type { Metadata } from "next";
import Link from "next/link";
import { InstallPlugin } from "@/components/install-plugin";
import { VERSION_EXTENSION } from "@/lib/extension";

export const metadata: Metadata = { title: "Installer Cordée", description: "Installe Cordée avec BRAT, sans télécharger les fichiers un par un, puis ouvre ton invitation directement dans Obsidian." };

export default function InstallerPage() {
  return <main id="contenu" className="shell py-14 sm:py-20"><div className="mx-auto max-w-2xl"><p className="eyebrow">Sur ordinateur et mobile</p><h1 className="mt-4 text-4xl font-medium tracking-tight sm:text-5xl">Installe. Rejoins. Écris.</h1><div className="mt-8"><InstallPlugin /></div><section id="mettre-a-jour" className="mt-12 border-t border-border pt-8"><h2 className="text-base font-medium">Déjà installée ? Mets-la à jour.</h2><p className="mt-3 text-sm leading-6 text-soft">Réglages → Modules complémentaires → « Vérifier les mises à jour », puis « Mettre à jour » sur Cordee. Avec BRAT : commande « BRAT: Check for updates to all beta plugins ». En cas d’« échec de l’installation », réessaie une minute plus tard ou utilise l’archive ZIP ci-dessus : tes réglages sont conservés. Désactive puis réactive Cordée ensuite.</p><p className="mt-3 text-sm"><Link prefetch={false} href="/fonctionnalites#nouveautes" className="underline underline-offset-4">Voir les nouveautés de la version {VERSION_EXTENSION}</Link></p></section><p className="mt-8 text-xs text-muted-foreground">Version {VERSION_EXTENSION} en test. Commence avec un coffre vide ; garde des sauvegardes de tes notes.</p></div></main>;
}
