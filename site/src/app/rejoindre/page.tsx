import type { Metadata } from "next";
import { Invitation } from "./invitation";

export const metadata: Metadata = {
  title: "Rejoindre un coffre",
  description: "Ouvre ton invitation Cordée et rejoins tes amis dans Obsidian.",
  robots: { index: false, follow: false },
};

export default function JoinPage() { return <Invitation />; }
