// Test de bout en bout : deux coffres en mémoire, le vrai moteur de l'extension et un vrai serveur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { demarrer, CODE } from './outils.ts';

const require = createRequire(import.meta.url);
const { Moteur, versBuffer, versTexte } = require('../../plugin/main.js').interne;

// Coffre factice : un dictionnaire chemin → contenu.
function coffreMemoire(initial: Record<string, string> = {}) {
  const f = new Map<string, { buf: ArrayBuffer; mtime: number }>();
  let horloge = 1;
  const poser = (p: string, buf: ArrayBuffer) => f.set(p, { buf, mtime: horloge++ });
  for (const [p, t] of Object.entries(initial)) poser(p, versBuffer(t));
  return {
    texte: (p: string) => (f.has(p) ? versTexte(f.get(p)!.buf) : null),
    chemins: () => [...f.keys()].sort(),
    modifier: (p: string, t: string) => poser(p, versBuffer(t)),
    effacer: (p: string) => f.delete(p),
    api: {
      lister: () => [...f.entries()].map(([chemin, v]) => ({ chemin, mtime: v.mtime, taille: v.buf.byteLength })),
      lire: async (p: string) => f.get(p)?.buf ?? null,
      ecrire: async (p: string, buf: ArrayBuffer) => poser(p, buf),
      supprimer: async (p: string) => { f.delete(p); },
      renommer: async (de: string, vers: string) => { const v = f.get(de); if (v) { f.delete(de); f.set(vers, v); } },
    },
  };
}

async function http({ methode, url, entetes, corps, type }: { methode: string; url: string; entetes?: Record<string, string>; corps?: string | ArrayBuffer; type?: string }) {
  const r = await fetch(url, { method: methode, headers: { ...(entetes || {}), ...(type ? { 'Content-Type': type } : {}) }, body: corps });
  const buf = await r.arrayBuffer();
  return { statut: r.status, json: async () => JSON.parse(new TextDecoder().decode(buf)), octets: async () => buf };
}

function moteur(url: string, coffreId: string, jeton: string, prenom: string, c: ReturnType<typeof coffreMemoire>) {
  const signaux: string[] = [];
  const m = new Moteur({
    etat: { serveur: url, coffreId, jeton, prenom, derniereRev: 0, bases: {}, cache: {} },
    fichiers: c.api, http, signaler: (q: string, e?: Error) => { signaux.push(q); if (q === 'erreur') throw e; },
  });
  return { m, signaux };
}

test('deux amis synchronisent, fusionnent et suppriment', async () => {
  const srv = await demarrer();
  try {
    const cree = (await srv.appel('POST', '/api/coffres', { nom: 'Révisions', prenom: 'Rafaël', codeCreation: CODE })).json;
    const code = (await srv.appel('POST', `/api/coffres/${cree.coffreId}/invitations`, {}, cree.jeton)).json.code;
    const paul = (await srv.appel('POST', '/api/rejoindre', { code, prenom: 'Paul' })).json;

    const cR = coffreMemoire({ 'Formulaire.md': 'titre\nligne 1\nligne 2\nligne 3', 'img/schema.png': 'PNG-v1' });
    const cP = coffreMemoire();
    const R = moteur(srv.url, cree.coffreId, cree.jeton, 'Rafaël', cR);
    const P = moteur(srv.url, cree.coffreId, paul.jeton, 'Paul', cP);

    // 1. Rafaël envoie son coffre, Paul le récupère.
    await R.m.synchroniser();
    await P.m.synchroniser();
    assert.deepEqual(cP.chemins(), ['Formulaire.md', 'img/schema.png']);
    assert.equal(cP.texte('Formulaire.md'), 'titre\nligne 1\nligne 2\nligne 3');

    // 2. Chacun modifie une ligne différente sans s'être synchronisé : fusion propre.
    cR.modifier('Formulaire.md', 'titre\nligne 1 par Rafaël\nligne 2\nligne 3');
    cP.modifier('Formulaire.md', 'titre\nligne 1\nligne 2\nligne 3 par Paul');
    await R.m.synchroniser();
    await P.m.synchroniser();
    await R.m.synchroniser();
    const attendu = 'titre\nligne 1 par Rafaël\nligne 2\nligne 3 par Paul';
    assert.equal(cP.texte('Formulaire.md'), attendu);
    assert.equal(cR.texte('Formulaire.md'), attendu);

    // 3. Image modifiée des deux côtés : les deux fichiers sont gardés.
    cR.modifier('img/schema.png', 'PNG-Rafael');
    cP.modifier('img/schema.png', 'PNG-Paul');
    await R.m.synchroniser();
    await P.m.synchroniser();
    await R.m.synchroniser();
    assert.equal(cP.texte('img/schema.png'), 'PNG-Rafael');
    const copie = cP.chemins().find((p) => p.includes('conflit Paul'));
    assert.ok(copie, 'copie de conflit attendue');
    assert.equal(cP.texte(copie!), 'PNG-Paul');
    assert.ok(cR.chemins().includes(copie!), 'la copie de Paul est partagée');

    // 4. Une suppression se propage.
    cR.effacer('Formulaire.md');
    await R.m.synchroniser();
    await P.m.synchroniser();
    assert.equal(cP.texte('Formulaire.md'), null);
    assert.ok(P.signaux.includes('ok'));
  } finally {
    await srv.arreter();
  }
});

test('le garde-fou bloque la disparition massive de fichiers', async () => {
  const srv = await demarrer();
  try {
    const cree = (await srv.appel('POST', '/api/coffres', { nom: 'Gros', prenom: 'R', codeCreation: CODE })).json;
    const notes: Record<string, string> = {};
    for (let i = 0; i < 30; i++) notes[`n${i}.md`] = `note ${i}`;
    const c = coffreMemoire(notes);
    const R = moteur(srv.url, cree.coffreId, cree.jeton, 'R', c);
    await R.m.synchroniser();
    for (let i = 0; i < 25; i++) c.effacer(`n${i}.md`);
    await R.m.synchroniser();
    assert.ok(R.signaux.includes('garde-fou'));
    const ch = (await srv.appel('GET', `/api/coffres/${cree.coffreId}/changements?depuis=0`, undefined, cree.jeton)).json;
    assert.equal(ch.changements.filter((x: { supprime: boolean }) => x.supprime).length, 0);
  } finally {
    await srv.arreter();
  }
});

test('un fichier trop gros est signalé sans lire son contenu ni supprimer sa version distante', async () => {
  const signaux: string[] = [];
  const etat = { serveur: 'https://cordee.example', coffreId: 'test', jeton: 'test-token', bases: { 'grand.pdf': 'version-distante' }, cache: {} };
  const interdit = async () => { assert.fail('Aucune lecture ou requête attendue'); };
  const m = new Moteur({ etat, http: interdit, fichiers: {
    lister: () => [{ chemin: 'grand.pdf', taille: 51 * 1024 * 1024, mtime: 1 }],
    lire: interdit,
  }, signaler: (q: string) => signaux.push(q) });
  await m.envoyer();
  assert.deepEqual(signaux, ['fichier-trop-gros']);
  assert.equal(etat.bases['grand.pdf'], 'version-distante');
});
