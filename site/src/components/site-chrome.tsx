import Link from "next/link";
import { Logo } from "@/components/logo";
import { MobileNav } from "@/components/mobile-nav";
import { BrandLogo } from "@/components/brand-logo";
import { NavLink } from "@/components/nav-link";

export const repository = "https://github.com/glm02/Obsidian-sync";

export function Header() {
  return <header className="site-header">
    <div className="shell relative flex h-20 items-center justify-between gap-4">
      <Link prefetch={false} href="/" aria-label="Cordée, accueil" className="flex items-center gap-3 text-base"><Logo /></Link>
      <nav aria-label="Navigation principale" className="hidden items-center gap-1 text-xs text-soft sm:flex">
        <NavLink href="/">Accueil</NavLink>
        <NavLink href="/installer">Installer</NavLink>
        <NavLink href="/deployer">Déployer</NavLink>
        <NavLink href="/guide">Guide</NavLink>
        <a href={repository} className="nav-github ml-4"><BrandLogo brand="github" className="size-4" />GitHub</a>
      </nav>
      <MobileNav repository={repository} />
    </div>
  </header>;
}

export function Footer() {
  return <footer className="border-t border-border">
    <div className="shell flex flex-col justify-between gap-5 py-8 text-xs text-soft sm:flex-row sm:items-center">
      <Link prefetch={false} href="/" aria-label="Cordée, accueil"><Logo /></Link>
      <div className="flex flex-wrap items-center gap-6"><Link prefetch={false} href="/installer">Installer</Link><Link prefetch={false} href="/deployer">Déployer</Link><Link prefetch={false} href="/guide">Guide</Link><a href={repository} className="flex items-center gap-2"><BrandLogo brand="github" className="size-3.5" />GitHub</a><a href={`${repository}/blob/main/LICENSE`}>MIT</a></div>
    </div>
  </footer>;
}
