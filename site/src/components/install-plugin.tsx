import { ArrowUpRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export function InstallPlugin() {
  return <div className="space-y-6">
    <p className="text-soft">La revue de Cordée est terminée. Cherche <strong>Cordee</strong> dans les modules complémentaires, ou utilise le bouton ci-dessous. La recherche peut prendre jusqu’à 24 heures pour se mettre à jour.</p>
    <ol className="space-y-6">
      <li><h3 className="font-medium">1. Ouvre un coffre vide dans Obsidian.</h3><p className="mt-2 text-sm text-soft">Ce sera l’espace partagé avec tes amis.</p></li>
      <li><h3 className="font-medium">2. Installe et active Cordee.</h3><p className="mt-2 text-sm text-soft">Obsidian ouvre la fiche de l’extension pour ce coffre.</p><Button asChild variant="outline" className="mt-3"><a href="obsidian://show-plugin?id=cordee">Ouvrir Cordee dans Obsidian <ArrowUpRight aria-hidden="true" /></a></Button></li>
      <li><h3 className="font-medium">3. Rouvre ton invitation.</h3><p className="mt-2 text-sm text-soft">Clique sur « Ouvrir dans Obsidian ». Le serveur est déjà renseigné : choisis ton nom affiché, puis rejoins. Ton serveur et ton nom seront retenus sur cet appareil pour les prochains coffres.</p></li>
    </ol>
    <details className="border-t border-border pt-4"><summary className="text-sm text-soft">Cordee n’apparaît pas encore ? Installer avec BRAT</summary><p className="my-4 text-sm text-soft">Pendant la propagation du catalogue, installe et active BRAT, puis ajoute Cordée avec le second bouton. BRAT gère aussi les mises à jour.</p><div className="flex flex-wrap gap-3"><Button asChild variant="outline"><a href="obsidian://show-plugin?id=obsidian42-brat">Installer BRAT <ArrowUpRight aria-hidden="true" /></a></Button><Button asChild variant="outline"><a href="obsidian://brat?plugin=glm02%2FObsidian-sync">Ajouter Cordée avec BRAT <ArrowUpRight aria-hidden="true" /></a></Button></div><p className="mt-3 text-xs text-muted-foreground">Dans BRAT, tu peux aussi choisir « Add a beta plugin » et coller <code>glm02/Obsidian-sync</code>.</p></details>
    <details className="border-t border-border pt-4"><summary className="text-sm text-soft">Autre méthode : une seule archive ZIP</summary><p className="my-4 text-sm text-soft">Décompresse le dossier <code>cordee</code> dans <code>.obsidian/plugins/</code> de ton coffre, puis active Cordee dans Obsidian. Aucun fichier JSON à modifier.</p><Button asChild variant="outline"><a href="https://github.com/glm02/Obsidian-sync/releases/latest/download/cordee.zip"><Download aria-hidden="true" />Télécharger Cordée</a></Button></details>
  </div>;
}
