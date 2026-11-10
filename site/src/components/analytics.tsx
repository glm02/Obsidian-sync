"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

/**
 * Mesure d'audience Vercel Web Analytics (sans cookie), chargée avec le script fourni par Vercel
 * plutôt qu'avec le paquet npm : une dépendance de moins à surveiller.
 *
 * Jamais sur /rejoindre : l'adresse d'une invitation porte le serveur et le code après le « # ».
 * La page promet de ne contenir aucun traceur, et elle doit continuer à le dire vrai.
 */
export function Analytics() {
  const chemin = usePathname();
  if (chemin?.startsWith("/rejoindre")) return null;
  return <>
    <Script id="vercel-analytics-init" strategy="afterInteractive">
      {"window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };"}
    </Script>
    <Script src="/_vercel/insights/script.js" strategy="afterInteractive" />
  </>;
}
