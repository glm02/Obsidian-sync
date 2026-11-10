import Image from "next/image";
import { cn } from "@/lib/utils";

export type Brand = "obsidian" | "github" | "docker" | "vercel";

export function BrandLogo({ brand, className }: { brand: Brand; className?: string }) {
  return <Image src={`/logos/${brand}.svg`} alt="" width={24} height={24} className={cn("size-5 shrink-0 brightness-0 invert", className)} data-brand={brand} />;
}

export function BrandStrip() {
  return <div className="shell brand-strip" aria-label="Les outils de Cordée">
    <p className="text-xs text-muted-foreground">Dans votre environnement.</p>
    <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:flex sm:items-center sm:justify-between sm:gap-8">{([
      ["obsidian", "Obsidian", "Vos notes"], ["github", "GitHub", "Code ouvert"], ["docker", "Docker", "Votre serveur"], ["vercel", "Vercel", "Ce site"],
    ] as const).map(([brand, name, label]) => <div key={brand} className="flex items-center gap-3 text-soft"><BrandLogo brand={brand} className="size-5 opacity-80" /><div className="leading-tight"><span className="text-sm font-medium text-[#d5d5d5]">{name}</span><span className="mt-1 block text-[10px] text-muted-foreground">{label}</span></div></div>)}</div>
  </div>;
}
