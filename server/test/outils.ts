// Démarre un serveur Cordée jetable pour les tests, dans un dossier temporaire.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { creerServeur } from '../src/serveur.ts';

export const CODE = 'code-de-test';

export async function demarrer() {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'cordee-'));
  const s = creerServeur({ dossierDonnees: dossier, codeCreation: CODE, tailleMaxOctets: 1024 * 1024, urlPublique: 'https://cordee.test' });
  await new Promise<void>((ok) => s.serveur.listen(0, '127.0.0.1', () => ok()));
  const url = `http://127.0.0.1:${(s.serveur.address() as AddressInfo).port}`;
  return {
    url,
    async arreter() { s.fermer(); fs.rmSync(dossier, { recursive: true, force: true }); },
    async appel(methode: string, chemin: string, corps?: unknown, jeton?: string) {
      const r = await fetch(url + chemin, {
        method: methode,
        headers: { ...(jeton ? { Authorization: 'Bearer ' + jeton } : {}), ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: corps === undefined ? undefined : JSON.stringify(corps),
      });
      const texte = await r.text();
      return { statut: r.status, json: texte ? JSON.parse(texte) : null };
    },
  };
}
