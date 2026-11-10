import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Footer, Header } from "@/components/site-chrome";
import { ScrollReveal } from "@/components/scroll-reveal";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: "Cordée — tes notes, tes amis, ton serveur", template: "%s · Cordée" },
  description: "Partage ton coffre Obsidian entre amis avec Cordée. Synchronisation quasi instantanée, fusion des notes et serveur auto-hébergé. Gratuit et open source.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body className={`${geist.variable} ${mono.variable}`}>
    <a className="skip-link" href="#contenu">Aller au contenu</a><Header />{children}<Footer /><ScrollReveal />
  </body></html>;
}
