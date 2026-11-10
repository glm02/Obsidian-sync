import { ArrowUpRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export function InstallPlugin() {
  return <div className="space-y-6">
    <p className="text-soft">Cordée prépare son arrivée dans le catalogue officiel. En attendant, BRAT installe l’extension et ses mises à jour à ta place.</p>
    <ol className="space-y-6">
      <li><h3 className="font-medium">1. Ouvre un coffre vide dans Obsidian.</h3><p className="mt-2 text-sm text-soft">Ce sera l’espace partagé avec tes amis.</p></li>
      <li><h3 className="font-medium">2. Installe et active BRAT.</h3><p className="mt-2 text-sm text-soft">Il se trouve dans le catalogue des modules complémentaires d’Obsidian.</p><Button asChild variant="outline" className="mt-3"><a href="obsidian://show-plugin?id=obsidian42-brat">Ouvrir BRAT dans Obsidian <ArrowUpRight aria-hidden="true" /></a></Button></li>
      <li><h3 className="font-medium">3. Ajoute Cordée.</h3><p className="mt-2 text-sm text-soft">BRAT demande une confirmation, puis installe les fichiers automatiquement. Active Cordee si nécessaire.</p><Button asChild variant="outline" className="mt-3"><a href="obsidian://brat?plugin=glm02%2FObsidian-sync">Ajouter Cordée avec BRAT <ArrowUpRight aria-hidden="true" /></a></Button><p className="mt-3 text-xs text-muted-foreground">Si le bouton ne s’ouvre pas : dans BRAT, choisis « Add a beta plugin » et colle <code>glm02/Obsidian-sync</code>.</p></li>
      <li><h3 className="font-medium">4. Rouvre ton invitation.</h3><p className="mt-2 text-sm text-soft">Clique sur « Ouvrir dans Obsidian ». L’invitation est préremplie : ajoute ton prénom, puis rejoins le coffre.</p></li>
    </ol>
    <details className="border-t border-border pt-4"><summary className="text-sm text-soft">Autre méthode : une seule archive ZIP</summary><p className="my-4 text-sm text-soft">Décompresse le dossier <code>cordee</code> dans <code>.obsidian/plugins/</code> de ton coffre, puis active Cordee dans Obsidian. Aucun fichier JSON à modifier.</p><Button asChild variant="outline"><a href="https://github.com/glm02/Obsidian-sync/releases/latest/download/cordee.zip"><Download aria-hidden="true" />Télécharger Cordée</a></Button></details>
  </div>;
}
