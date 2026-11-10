"use client";

import { useRef } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

export function MobileNav({ repository }: { repository: string }) {
  const menu = useRef<HTMLDetailsElement>(null);
  function close() { if (menu.current) menu.current.open = false; }
  return <details ref={menu} className="mobile-menu sm:hidden" onKeyDown={event => {
    if (event.key === "Escape") { close(); menu.current?.querySelector("summary")?.focus(); }
  }}>
    <summary className="flex h-10 items-center gap-2 rounded-full border border-input px-4 text-xs text-soft hover:bg-secondary hover:text-foreground">Menu <ChevronDown className="size-3" aria-hidden="true" /></summary>
    <nav onClick={event => { if ((event.target as HTMLElement).closest("a")) close(); }} aria-label="Navigation mobile" className="absolute right-0 top-16 z-30 flex w-52 flex-col rounded-lg border border-input bg-background p-2 shadow-xl shadow-black/30">
      <Link prefetch={false} href="/" className="rounded-md px-4 py-3 hover:bg-secondary">Accueil</Link>
      <Link prefetch={false} href="/deployer" className="rounded-md px-4 py-3 hover:bg-secondary">Déployer</Link>
      <Link prefetch={false} href="/guide" className="rounded-md px-4 py-3 hover:bg-secondary">Guide</Link>
      <a href={repository} className="rounded-md px-4 py-3 hover:bg-secondary">GitHub</a>
    </nav>
  </details>;
}
