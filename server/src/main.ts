// Point d'entrée : lit la configuration dans les variables d'environnement et démarre le serveur.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { creerServeur } from './serveur.ts';

const dossier = path.resolve(process.env.CORDEE_DONNEES || './donnees');
fs.mkdirSync(dossier, { recursive: true });

// Sans code fourni, on en génère un et on le garde dans un fichier lisible par le seul propriétaire du serveur.
// Le code n'est jamais écrit dans les journaux.
let code = process.env.CORDEE_CODE_CREATION || '';
const fichierCode = path.join(dossier, 'code-creation.txt');
if (!code) {
  if (!fs.existsSync(fichierCode)) fs.writeFileSync(fichierCode, randomBytes(18).toString('base64url') + '\n', { mode: 0o600 });
  code = fs.readFileSync(fichierCode, 'utf8').trim();
  console.log(`Code de création de coffre : voir ${fichierCode}`);
}

const port = Number(process.env.CORDEE_PORT || 8787);
const { serveur } = creerServeur({
  dossierDonnees: dossier,
  codeCreation: code,
  tailleMaxOctets: Number(process.env.CORDEE_TAILLE_MAX_MO || 50) * 1024 * 1024,
  urlPublique: process.env.CORDEE_URL_PUBLIQUE,
});
serveur.listen(port, () => console.log(`Cordée écoute sur le port ${port}, données dans ${dossier}`));
