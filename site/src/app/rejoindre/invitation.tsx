"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowRight, Link2, LockKeyhole } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { parseInvitation, obsidianInvitationUrl } from "@/lib/invitation";

function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}
function getSnapshot() { return window.location.hash; }
function getServerSnapshot() { return null; }

export function Invitation() {
  const fragment = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const invitation = fragment === null ? null : parseInvitation(fragment);

  return <main id="contenu" className="shell min-h-[calc(100svh-200px)] py-14 sm:py-20"><div className="mx-auto max-w-xl">
    <div className="mb-7 flex size-12 items-center justify-center rounded-lg border border-input"><Link2 className="size-5" aria-hidden="true" /></div>
    <p className="eyebrow">Une place dans la cordée</p>
    <h1 className="mt-4 text-[32px] font-medium leading-tight tracking-[-.04em] sm:text-[40px]">Tu es invité à rejoindre un coffre Cordée.</h1>
    {fragment === null ? <p className="mt-8 text-soft" role="status">Lecture de ton invitation…</p> : !invitation ? <div className="my-8 rounded-lg border border-input p-6"><h2 className="text-base font-medium">Lien incomplet, demande un nouveau lien à ton ami</h2><p className="mt-3 text-soft">L’invitation doit contenir l’adresse du serveur et un code valide après le signe #. Demande à ton ami de copier le lien entier.</p><Button asChild variant="outline" className="mt-6"><Link prefetch={false} href="/installer">Installer l’extension <ArrowRight aria-hidden="true" /></Link></Button></div> : <>
      <p className="mt-4 text-soft">Ton ami t’a envoyé les clés d’un espace de notes partagé. Voici les informations à utiliser dans l’extension.</p>
      <dl className="my-8 rounded-lg border border-input"><div className="border-b border-border p-5"><dt className="mb-2 text-xs text-soft">Serveur</dt><dd className="break-all font-mono text-xs sm:text-sm">{invitation.serveur}</dd></div><div className="p-5"><dt className="mb-2 text-xs text-soft">Code d’invitation</dt><dd className="break-all font-mono text-lg tracking-wider">{invitation.code}</dd></div></dl>
      <div className="flex flex-wrap items-start gap-3"><Button asChild><a href={obsidianInvitationUrl(invitation)}>Ouvrir dans Obsidian <ArrowRight aria-hidden="true" /></a></Button><CopyButton pageUrl label="Copier le lien" /></div>
      <p className="mt-4 text-sm text-soft">Première fois ? <Link prefetch={false} href="/installer" className="text-foreground underline underline-offset-4">Installer Cordée</Link>. Le bouton ouvre l’extension ; tu confirmes ensuite avec ton prénom.</p>
      <section id="etapes" tabIndex={-1} aria-label="Étapes pour rejoindre" className="mt-10 border-t border-border pt-8"><h2 className="text-base font-medium">Trois étapes pour rejoindre</h2><ol className="mt-6 space-y-6">{[
        <>Installe <strong className="font-medium text-foreground">Obsidian</strong> sur ton ordinateur ou ton téléphone, puis ouvre de préférence un coffre vide.</>,
        <>Installe <Link prefetch={false} href="/installer" className="text-foreground underline underline-offset-4">l’extension Cordée avec BRAT</Link> et active-la dans les modules complémentaires.</>,
        <>Clique sur <strong className="font-medium text-foreground">Ouvrir dans Obsidian</strong>, ajoute ton prénom, puis clique sur Rejoindre. Tu peux aussi coller le lien dans Cordée.</>,
      ].map((step, i) => <li key={i} className="flex items-start gap-4"><span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-input font-mono text-[10px] text-soft">0{i + 1}</span><span className="text-soft">{step}</span></li>)}</ol></section>
      <p className="mt-8 text-xs text-soft">Version 0.1 en test, fais une copie de ton coffre.</p>
    </>}
    <p className="mt-8 flex items-start gap-2 text-xs text-soft"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span>Le fragment après # n’est pas envoyé à Vercel. Seul ton clic sur « Ouvrir dans Obsidian » transmet l’invitation à l’application. Cette page ne contacte pas le serveur et ne contient aucun traceur.</span></p>
  </div></main>;
}
