// Test de bout en bout : deux coffres en mémoire, le vrai moteur de l'extension et un vrai serveur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { demarrer, CODE } from './outils.ts';

const require = createRequire(import.meta.url);
const { Moteur, versBuffer, versTexte, empreinte, ecouterRevisions } = require('../../plugin/main.js').interne;

// Coffre factice : un dictionnaire chemin → contenu.
function coffreMemoire(initial: Record<string, string> = {}) {
  const f = new Map<string, { buf: ArrayBuffer; mtime: number }>();
  const dirs = new Set<string>();
  const caches = new Set<string>();
  let horloge = 1;
  const dossier = (p: string) => { const parties = p.split('/'); for (let i = 1; i <= parties.length; i++) dirs.add(parties.slice(0, i).join('/')); };
  const poser = (p: string, buf: ArrayBuffer) => { if (p.includes('/')) dossier(p.slice(0, p.lastIndexOf('/'))); f.set(p, { buf, mtime: horloge++ }); };
  for (const [p, t] of Object.entries(initial)) poser(p, versBuffer(t));
  return {
    texte: (p: string) => (f.has(p) ? versTexte(f.get(p)!.buf) : null),
    chemins: () => [...f.keys()].sort(),
    dossiers: () => [...dirs].sort(),
    creerDossier: dossier,
    proteger: (p: string) => { dossier(p.slice(0, p.lastIndexOf('/'))); caches.add(p); },
    estProtege: (p: string) => caches.has(p),
    retirerArbre: (p: string) => { for (const nom of f.keys()) if (nom === p || nom.startsWith(p + '/')) f.delete(nom); for (const nom of dirs) if (nom === p || nom.startsWith(p + '/')) dirs.delete(nom); },
    modifier: (p: string, t: string) => poser(p, versBuffer(t)),
    effacer: (p: string) => f.delete(p),
    api: {
      lister: () => [...f.entries()].map(([chemin, v]) => ({ chemin, mtime: v.mtime, taille: v.buf.byteLength })),
      listerDossiers: () => [...dirs],
      creerDossier: async (p: string) => { dossier(p); },
      supprimerDossierVide: async (p: string) => {
        if ([...f.keys(), ...caches, ...dirs].some(nom => nom.startsWith(p + '/'))) return false;
        dirs.delete(p); return true;
      },
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

test('le flux reçoit une note entre deux coffres sans attendre un sondage', { timeout: 8000 }, async (t) => {
  const srv = await demarrer();
  const controleur = new AbortController();
  let flux: Promise<void> | undefined;
  try {
    const cree = (await srv.appel('POST', '/api/coffres', { nom: 'Test direct', prenom: 'Agent A', codeCreation: CODE })).json;
    const code = (await srv.appel('POST', `/api/coffres/${cree.coffreId}/invitations`, {}, cree.jeton)).json.code;
    const rejoint = (await srv.appel('POST', '/api/rejoindre', { code, prenom: 'Agent B' })).json;
    const a = coffreMemoire(), b = coffreMemoire();
    const A = moteur(srv.url, cree.coffreId, cree.jeton, 'Agent A', a).m;
    const B = moteur(srv.url, cree.coffreId, rejoint.jeton, 'Agent B', b).m;
    const abonne = Promise.withResolvers<void>();
    const recu = Promise.withResolvers<void>();
    flux = ecouterRevisions({
      url: `${srv.url}/api/coffres/${cree.coffreId}/evenements`, jeton: rejoint.jeton, signal: controleur.signal,
      recevoir: (rev: number) => {
        if (rev === 0) abonne.resolve();
        if (rev > B.etat.derniereRev) B.synchroniser().then(() => {
          if (b.texte('test.md') === 'Modification instantanée') recu.resolve();
        }).catch(recu.reject);
      },
    });
    flux.catch(recu.reject);
    await abonne.promise;
    const debut = performance.now();
    a.modifier('test.md', 'Modification instantanée');
    await A.synchroniser(); await recu.promise;
    assert.equal(b.texte('test.md'), 'Modification instantanée');
    t.diagnostic(`Envoi et réception par notification : ${Math.round(performance.now() - debut)} ms sur serveur local.`);
  } finally {
    controleur.abort(); await flux?.catch(() => {});
    await srv.arreter();
  }
});

test('les notifications fragmentées, CRLF et JSON invalides sont traitées sans exposer le jeton', async () => {
  const revisions: number[] = [];
  const morceaux = ['data: {"re', 'v":1}\r', '\n\r\n: ping\r\n\r\ndata: faux\n\ndata: {"rev":-1}\n\n', 'data: {"rev":\n', 'data: 2}\n\ndata: {"rev":"3"}\n\n'];
  await ecouterRevisions({
    url: 'https://cordee.example/api/coffres/test/evenements', jeton: 'jeton-fictif', signal: new AbortController().signal,
    recevoir: (rev: number) => revisions.push(rev),
    requete: async (url: string, options: RequestInit) => {
      assert.equal(url.includes('jeton-fictif'), false);
      assert.equal((options.headers as Record<string, string>).Authorization, 'Bearer jeton-fictif');
      assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
      return new Response(new ReadableStream({ start(c) { for (const m of morceaux) c.enqueue(new TextEncoder().encode(m)); c.close(); } }), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    },
  });
  assert.deepEqual(revisions, [1, 2]);
});

test('un fichier modifié entre son hachage et son envoi garde une empreinte cohérente', async () => {
  let lectures = 0;
  const ancien = versBuffer('avant'), nouveau = versBuffer('apres');
  const m = new Moteur({ etat: { bases: {}, cache: {} }, fichiers: {
    lister: () => [{ chemin: 'note.md', taille: 5, mtime: 1 }],
    lire: async () => ++lectures === 1 ? ancien : nouveau,
  } });
  let empreinteEnvoyee = '';
  m.envoyerBlob = async (hash: string, contenu: ArrayBuffer) => {
    assert.equal(hash, await empreinte(contenu)); assert.equal(versTexte(contenu), 'apres'); empreinteEnvoyee = hash;
  };
  m.valider = async (_: string, hash: string) => { assert.equal(hash, empreinteEnvoyee); return 200; };
  await m.envoyer();
  assert.equal(m.etat.bases['note.md'], await empreinte(nouveau));
});

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

test("un fichier de l'ami qu'on ne peut pas écrire ne bloque ni l'envoi de nos documents ni le reste", async () => {
  const srv = await demarrer();
  try {
    const cree = (await srv.appel('POST', '/api/coffres', { nom: 'Révisions', prenom: 'Alice', codeCreation: CODE })).json;
    const code = (await srv.appel('POST', `/api/coffres/${cree.coffreId}/invitations`, {}, cree.jeton)).json.code;
    const bruno = (await srv.appel('POST', '/api/rejoindre', { code, prenom: 'Bruno' })).json;

    const cB = coffreMemoire({ 'S3/PAPP3/cours.pdf': 'pdf bruno', 'S3/ENER3/fiche.md': 'fiche de Bruno' });
    const cR = coffreMemoire({ 'S3/SAE/nouveau.md': 'ajouté par git pull, hors Obsidian' });
    const B = moteur(srv.url, cree.coffreId, bruno.jeton, 'Bruno', cB);
    await B.m.synchroniser();

    // Chez Alice, un chemin précis ne peut pas être écrit (ex. nom déjà pris à la casse près).
    const ecrireOrigine = cR.api.ecrire;
    let panne = true;
    cR.api.ecrire = async (p: string, buf: ArrayBuffer) => { if (panne && p === 'S3/PAPP3/cours.pdf') throw new Error('Le dossier existe déjà'); return ecrireOrigine(p, buf); };
    const R = moteur(srv.url, cree.coffreId, cree.jeton, 'Alice', cR);
    const bloques: string[] = [];
    (R.m as { signaler: (q: string, a?: string) => void }).signaler = (q, a) => { if (q === 'fichier-bloque') bloques.push(String(a)); if (q === 'erreur') throw a; };

    await R.m.synchroniser();
    // L'envoi n'est pas bloqué : Bruno reçoit le document de Alice.
    await B.m.synchroniser();
    assert.equal(cB.texte('S3/SAE/nouveau.md'), 'ajouté par git pull, hors Obsidian');
    // Les autres fichiers de Bruno arrivent chez Alice, seul le fichier en panne est mis de côté.
    assert.equal(cR.texte('S3/ENER3/fiche.md'), 'fiche de Bruno');
    assert.equal(cR.texte('S3/PAPP3/cours.pdf'), null);
    assert.deepEqual(bloques, ['S3/PAPP3/cours.pdf']);
    assert.deepEqual(Object.keys(R.m.etat.enAttente), ['fichier:S3/PAPP3/cours.pdf']);

    // La panne disparaît : le fichier est repris à la synchro suivante, sans nouvelle action de Bruno.
    panne = false;
    await R.m.synchroniser();
    assert.equal(cR.texte('S3/PAPP3/cours.pdf'), 'pdf bruno');
    assert.deepEqual(Object.keys(R.m.etat.enAttente), []);
  } finally { await srv.arreter(); }
});

test("une vraie panne du serveur arrête toujours la synchro, avec un message de connexion", async () => {
  const c = coffreMemoire({ 'a.md': 'a' });
  const erreurs: Array<Error & { reseau?: boolean }> = [];
  const m = new Moteur({
    etat: { serveur: 'https://serveur.invalide', coffreId: 'x', jeton: 't', prenom: 'R', derniereRev: 0, bases: {}, cache: {} },
    fichiers: c.api,
    http: async () => { throw new Error('getaddrinfo ENOTFOUND'); },
    signaler: (q: string, e?: Error & { reseau?: boolean }) => { if (q === 'erreur') erreurs.push(e!); },
  });
  await m.synchroniser();
  assert.equal(erreurs.length, 1);
  assert.equal(erreurs[0].reseau, true);
});

async function deuxCoffres(initialA: Record<string, string> = {}) {
  const srv = await demarrer();
  const cree = (await srv.appel('POST', '/api/coffres', { nom: 'Groupe', prenom: 'Alice', codeCreation: CODE })).json;
  const code = (await srv.appel('POST', `/api/coffres/${cree.coffreId}/invitations`, {}, cree.jeton)).json.code;
  const bruno = (await srv.appel('POST', '/api/rejoindre', { code, prenom: 'Bruno' })).json;
  const cA = coffreMemoire(initialA);
  const cB = coffreMemoire();
  const A = moteur(srv.url, cree.coffreId, cree.jeton, 'Alice', cA);
  const B = moteur(srv.url, cree.coffreId, bruno.jeton, 'Bruno', cB);
  const sync = async () => { await A.m.synchroniser(); await B.m.synchroniser(); await A.m.synchroniser(); };
  return { srv, cA, cB, A, B, sync };
}

test("supprimer un dossier entier chez l'un le supprime chez l'autre, sous-dossiers compris", async () => {
  const { srv, cA, cB, sync } = await deuxCoffres({
    'Cours/TD/a.md': 'a', 'Cours/TD/Corrections/b.pdf': 'b', 'Cours/TD/Corrections/Brouillons/c.md': 'c', 'Cours/Notes/n.md': 'n',
  });
  try {
    cA.creerDossier('Cours/Vide');
    await sync();
    assert.deepEqual(cB.chemins(), ['Cours/Notes/n.md', 'Cours/TD/Corrections/Brouillons/c.md', 'Cours/TD/Corrections/b.pdf', 'Cours/TD/a.md']);
    assert.ok(cB.dossiers().includes('Cours/Vide'), 'le dossier vide arrive aussi');

    // Alice supprime le dossier depuis l'explorateur de fichiers : tout son contenu disparaît d'un coup.
    cA.retirerArbre('Cours/TD');
    await sync();
    assert.deepEqual(cB.chemins(), ['Cours/Notes/n.md']);
    assert.deepEqual(cB.dossiers().filter((d) => d.startsWith('Cours/TD')), [], 'aucun dossier fantôme chez Bruno');
    assert.ok(cB.dossiers().includes('Cours/Vide') && cB.dossiers().includes('Cours/Notes'), 'les autres dossiers restent');

    // Et dans l'autre sens : Bruno supprime un dossier vide, Alice le perd aussi.
    cB.retirerArbre('Cours/Vide');
    await sync();
    assert.ok(!cA.dossiers().includes('Cours/Vide'));
  } finally { await srv.arreter(); }
});

test("un gros dossier supprimé volontairement part chez l'autre après confirmation, pas avant", async () => {
  const notes: Record<string, string> = {};
  for (let i = 0; i < 30; i++) notes[`Gros/n${i}.md`] = `note ${i}`;
  notes['Petit/p.md'] = 'p';
  const { srv, cA, cB, A, B, sync } = await deuxCoffres(notes);
  try {
    await sync();
    assert.equal(cB.chemins().length, 31);
    cA.retirerArbre('Gros');
    await A.m.synchroniser();
    await B.m.synchroniser();
    // Le garde-fou protège d'un accident : rien n'a bougé chez Bruno, et Alice est prévenue.
    assert.ok(A.signaux.includes('garde-fou'));
    assert.equal(cB.chemins().length, 31);
    assert.equal(A.m.suppressionsEnAttente(), 30);
    // Alice confirme : la suppression est voulue, elle part.
    A.m.autoriserSuppressions();
    await A.m.synchroniser();
    await B.m.synchroniser();
    assert.deepEqual(cB.chemins(), ['Petit/p.md']);
    assert.deepEqual(cB.dossiers().filter((d) => d.startsWith('Gros')), []);
    assert.equal(A.m.suppressionsEnAttente(), 0);
    // L'autorisation ne vaut que pour cette fois.
    cA.modifier('Petit/q.md', 'q');
    await A.m.synchroniser();
    assert.equal(A.m.suppressionsAutorisees, false);
  } finally { await srv.arreter(); }
});

test("si l'ami a ajouté un fichier dans le dossier supprimé, le fichier est conservé et le dossier revient", async () => {
  const { srv, cA, cB, sync } = await deuxCoffres({ 'Projet/a.md': 'a', 'Projet/b.md': 'b' });
  try {
    await sync();
    cA.retirerArbre('Projet');
    cB.modifier('Projet/nouveau.md', 'ajouté par Bruno pendant ce temps');
    await sync();
    assert.equal(cB.texte('Projet/nouveau.md'), 'ajouté par Bruno pendant ce temps');
    assert.equal(cA.texte('Projet/nouveau.md'), 'ajouté par Bruno pendant ce temps');
    assert.equal(cB.texte('Projet/a.md'), null);
    assert.equal(cA.texte('Projet/a.md'), null);
  } finally { await srv.arreter(); }
});

test("quand un ami modifie une note, on sait exactement quelles lignes surligner", async () => {
  const { srv, cA, cB, A, B } = await deuxCoffres({ 'Cours.md': 'titre\nligne 1\nligne 2\n\nfin' });
  try {
    const signaux: Array<{ chemin: string; info: { auteur: string; lignes: string[]; ajouts: number; suppressions: number; nouveau: boolean } }> = [];
    (B.m as { signaler: (q: string, a?: unknown, b?: unknown) => void }).signaler = (q, a, b) => { if (q === 'modifie-par') signaux.push({ chemin: a as string, info: b as never }); if (q === 'erreur') throw a; };
    await A.m.synchroniser();
    await B.m.synchroniser();
    assert.equal(signaux[0].chemin, 'Cours.md');
    assert.equal(signaux[0].info.nouveau, true, 'une note qui arrive est « nouvelle »');
    assert.equal(signaux[0].info.auteur, 'Alice');

    signaux.length = 0;
    cA.modifier('Cours.md', 'titre\nligne 1 corrigée par Alice\nligne 2\n\nfin\najout final');
    await A.m.synchroniser();
    await B.m.synchroniser();
    assert.equal(signaux.length, 1);
    assert.deepEqual(signaux[0].info.lignes, ['ligne 1 corrigée par Alice', 'ajout final']);
    assert.equal(signaux[0].info.ajouts, 2);
    assert.equal(signaux[0].info.suppressions, 1);
    assert.equal(signaux[0].info.nouveau, false);
    assert.equal(cB.texte('Cours.md'), 'titre\nligne 1 corrigée par Alice\nligne 2\n\nfin\najout final');

    // Nos propres envois ne sont pas « à voir » chez nous.
    signaux.length = 0;
    cB.modifier('Cours.md', 'titre de Bruno\nligne 1 corrigée par Alice\nligne 2\n\nfin\najout final');
    await B.m.synchroniser();
    await B.m.synchroniser();
    assert.equal(signaux.length, 0);
  } finally { await srv.arreter(); }
});
