"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyButton({ text, pageUrl = false, label = "Copier", primary = false }: { text?: string; pageUrl?: boolean; label?: string; primary?: boolean }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(pageUrl ? window.location.href : (text ?? ""));
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 2500);
    } catch { setStatus("error"); }
  }
  return <span className="inline-flex flex-col items-start gap-1">
    <Button variant={primary ? "default" : "outline"} size={primary ? "default" : "sm"} onClick={copy}>
      {status === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {status === "copied" ? "Copié" : label}
    </Button>
    <span role="status" className="text-xs text-soft">{status === "error" ? "Copie indisponible : sélectionne et copie le texte manuellement." : status === "copied" ? "Copie dans le presse-papiers effectuée." : ""}</span>
  </span>;
}
