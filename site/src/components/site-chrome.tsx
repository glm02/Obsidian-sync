import Link from "next/link";
import { Logo } from "@/components/logo";
import { MobileNav } from "@/components/mobile-nav";

export const repository = "https://github.com/glm02/Obsidian-sync";

export function Header() {
  return <header className="border-b border-border">
    <div className="shell relative flex h-20 items-center justify-between gap-4">
      <Link prefetch={false} href="/" aria-label="Cordée, accueil" className="flex items-center gap-3 text-base"><Logo /><span className="rounded-full border border-input px-2 py-0.5 text-[10px] text-soft">v0.1</span></Link>
      <nav aria-label="Navigation principale" className="hidden items-center gap-8 text-soft sm:flex">
        <Link prefetch={false} href="/" className="hover:text-foreground">Accueil</Link>
        <Link prefetch={false} href="/deployer" className="hover:text-foreground">Déployer</Link>
        <Link prefetch={false} href="/guide" className="hover:text-foreground">Guide</Link>
        <a href={repository} className="hover:text-foreground">GitHub</a>
      </nav>
      <MobileNav repository={repository} />
    </div>
  </header>;
}

export function Footer() {
  return <footer className="border-t border-border">
    <div className="shell flex flex-col justify-between gap-5 py-8 text-xs text-soft sm:flex-row sm:items-center">
      <Link prefetch={false} href="/" className="flex flex-wrap items-center gap-4"><Logo className="text-sm" /><span>Les notes se partagent.</span></Link>
      <div className="flex flex-wrap gap-6"><Link prefetch={false} href="/deployer">Déployer</Link><Link prefetch={false} href="/guide">Guide</Link><a href={repository}>GitHub</a><a href={`${repository}/blob/main/LICENSE`}>Licence MIT</a></div>
    </div>
  </footer>;
}
