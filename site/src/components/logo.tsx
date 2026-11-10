import { Mountain } from "lucide-react";
import { cn } from "@/lib/utils";

// Symbole provisoire : remplacer ici pour mettre à jour la barre et le pied de page.
// Le favicon est indépendant : src/app/icon.svg.
export function Logo({ className }: { className?: string }) {
  return <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight text-foreground", className)}>
    <Mountain className="size-6 shrink-0" aria-hidden="true" /><span>Cordée</span>
  </span>;
}
