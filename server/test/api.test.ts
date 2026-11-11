// Tests de l'API : création, invitation, accès, écriture conditionnelle, sécurité des chemins.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { creerServeur } from '../src/serveur.ts';
import { demarrer, CODE } from './outils.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
// Images artificielles d'un pixel, sans photographie ni métadonnée personnelle.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=';
const WEBP = 'data:image/webp;base64,UklGRjIAAABXRUJQVlA4ICYAAACQAQCdASoBAAEAAUAmJQBOl0AAhgAA/uJGvtTBJGUv+vgCniQAAA==';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDQooor0jgP/9k=';
let srv: Awaited<ReturnType<typeof demarrer>>;
async function ecrireVersion(s: Awaited<ReturnType<typeof demarrer>>, coffreId: string, jeton: string,
  chemin: string, contenu: string | Buffer | null, base: string | null = null) {
  const hash = contenu === null ? null : createHash('sha256').update(contenu).digest('hex');
  const route = `/api/coffres/${coffreId}`;
  if (contenu !== null) assert.equal((await fetch(`${s.url}${route}/blobs/${hash}`, {
    method: 'PUT', body: contenu, headers: { Authorization: 'Bearer ' + jeton },
  })).status, 200);
  const resultat = await s.appel('POST', route + '/fichiers', { chemin, hash, base }, jeton);
  assert.equal(resultat.statut, 200, JSON.stringify(resultat.json));
  return { rev: resultat.json.rev as number, hash };
}
before(async () => { srv = await demarrer(); });
after(async () => { await srv.arreter(); });

test('parcours complet : créer, inviter, rejoindre, écrire, lire', async () => {
  assert.equal((await srv.appel('POST', '/api/coffres', { nom: 'ENER3', prenom: 'Rafaël', codeCreation: 'faux' })).statut, 403);

  const c = await srv.appel('POST', '/api/coffres', { nom: 'ENER3', prenom: 'Rafaël', codeCreation: CODE });
  assert.equal(c.statut, 201);
  const { coffreId, jeton } = c.json;

  const inv = await srv.appel('POST', `/api/coffres/${coffreId}/invitations`, {}, jeton);
  assert.equal(inv.statut, 201);
  assert.match(inv.json.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(inv.json.lien, `https://cordee.test/rejoindre/${inv.json.code}`);

  const j = await srv.appel('POST', '/api/rejoindre', { code: inv.json.code.toLowerCase(), prenom: 'Paul' });
  assert.equal(j.statut, 201);
  assert.equal(j.json.coffreId, coffreId);
  const jetonPaul = j.json.jeton;

  const info = await srv.appel('GET', `/api/coffres/${coffreId}`, undefined, jetonPaul);
  assert.deepEqual(info.json.membres.map((m: { nom: string }) => m.nom), ['Rafaël', 'Paul']);

  // Le fichier doit d'abord être envoyé, avec une empreinte exacte.
  const contenu = '# Formulaire\n';
  const h = sha(contenu);
  assert.equal((await srv.appel('POST', `/api/coffres/${coffreId}/fichiers`, { chemin: 'a.md', hash: h, base: null }, jeton)).statut, 400);
  const mauvais = await fetch(`${srv.url}/api/coffres/${coffreId}/blobs/${sha('autre')}`, { method: 'PUT', body: contenu, headers: { Authorization: 'Bearer ' + jeton } });
  assert.equal(mauvais.status, 400);
  const bon = await fetch(`${srv.url}/api/coffres/${coffreId}/blobs/${h}`, { method: 'PUT', body: contenu, headers: { Authorization: 'Bearer ' + jeton } });
  assert.equal(bon.status, 200);

  const w = await srv.appel('POST', `/api/coffres/${coffreId}/fichiers`, { chemin: 'a.md', hash: h, base: null }, jeton);
  assert.deepEqual(w.json, { rev: 1 });

  // Paul écrit en partant d'une version périmée : refus 409 avec la version actuelle.
  const perime = await srv.appel('POST', `/api/coffres/${coffreId}/fichiers`, { chemin: 'a.md', hash: null, base: null }, jetonPaul);
  assert.equal(perime.statut, 409);
  assert.equal(perime.json.actuel, h);

  const ch = await srv.appel('GET', `/api/coffres/${coffreId}/changements?depuis=0`, undefined, jetonPaul);
  assert.equal(ch.json.changements.length, 1);
  assert.equal(ch.json.changements[0].auteur, 'Rafaël');

  const lu = await fetch(`${srv.url}/api/coffres/${coffreId}/blobs/${h}`, { headers: { Authorization: 'Bearer ' + jetonPaul } });
  assert.equal(await lu.text(), contenu);

  // Paul quitte : son jeton ne marche plus.
  assert.equal((await srv.appel('DELETE', `/api/coffres/${coffreId}/membres/moi`, undefined, jetonPaul)).statut, 200);
  assert.equal((await srv.appel('GET', `/api/coffres/${coffreId}`, undefined, jetonPaul)).statut, 403);
});

test('un membre ne voit pas les autres coffres', async () => {
  const a = await srv.appel('POST', '/api/coffres', { nom: 'A', prenom: 'X', codeCreation: CODE });
  const b = await srv.appel('POST', '/api/coffres', { nom: 'B', prenom: 'Y', codeCreation: CODE });
  assert.equal((await srv.appel('GET', `/api/coffres/${b.json.coffreId}`, undefined, a.json.jeton)).statut, 403);
  assert.equal((await srv.appel('GET', `/api/coffres/${b.json.coffreId}`)).statut, 401);
});

test('chemins dangereux refusés', async () => {
  const a = await srv.appel('POST', '/api/coffres', { nom: 'C', prenom: 'Z', codeCreation: CODE });
  for (const chemin of ['../x.md', '/etc/passwd', 'a/../../b.md', 'a\\b.md', 'a//b.md', '']) {
    const r = await srv.appel('POST', `/api/coffres/${a.json.coffreId}/fichiers`, { chemin, hash: null, base: null }, a.json.jeton);
    assert.equal(r.statut, 400, chemin);
  }
});

test('les membres connectés sont prévenus en direct d\'un changement', async () => {
  const a = await srv.appel('POST', '/api/coffres', { nom: 'D', prenom: 'W', codeCreation: CODE });
  const { coffreId, jeton } = a.json;
  const ctrl = new AbortController();
  const r = await fetch(`${srv.url}/api/coffres/${coffreId}/evenements`, { headers: { Authorization: 'Bearer ' + jeton }, signal: ctrl.signal });
  const lecteur = r.body!.getReader();
  const lire = async () => new TextDecoder().decode((await lecteur.read()).value);
  assert.match(await lire(), /"rev":0/);
  const h = sha('x');
  await fetch(`${srv.url}/api/coffres/${coffreId}/blobs/${h}`, { method: 'PUT', body: 'x', headers: { Authorization: 'Bearer ' + jeton } });
  await srv.appel('POST', `/api/coffres/${coffreId}/fichiers`, { chemin: 'x.md', hash: h, base: null }, jeton);
  assert.match(await lire(), /"rev":1/);
  ctrl.abort();
});

test('invitation inconnue refusée, et les essais en rafale sont limités', async () => {
  let dernier = 0;
  for (let i = 0; i < 12; i++) dernier = (await srv.appel('POST', '/api/rejoindre', { code: 'AAAA-BBBB-CCCC', prenom: 'Intrus' })).statut;
  assert.equal(dernier, 429);
});

test('derrière un proxy, chaque adresse a sa propre limite', async () => {
  const proxy = await demarrer({ derriereProxy: true });
  const essai = (ip: string) => fetch(proxy.url + '/api/rejoindre', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip },
    body: JSON.stringify({ code: 'AAAA-BBBB-CCCC', prenom: 'Intrus' }),
  }).then((r) => r.status);
  let dernier = 0;
  for (let i = 0; i < 12; i++) dernier = await essai('203.0.113.1');
  assert.equal(dernier, 429);
  // Un autre visiteur n'est pas bloqué par l'intrus.
  assert.equal(await essai('203.0.113.2'), 404);
  await proxy.arreter();
});

test("avec une page d'invitation, le lien y mène et porte le serveur après le #", async () => {
  const s = await demarrer({ pageInvitation: 'https://cordee.vercel.app/rejoindre' });
  const c = await s.appel('POST', '/api/coffres', { nom: 'Groupe', prenom: 'Léa', codeCreation: CODE });
  const inv = await s.appel('POST', `/api/coffres/${c.json.coffreId}/invitations`, {}, c.json.jeton);
  assert.equal(inv.json.lien, `https://cordee.vercel.app/rejoindre#serveur=${encodeURIComponent('https://cordee.test')}&code=${inv.json.code}`);
  await s.arreter();
});

test('les photos sont limitées à leur coffre et les changements gardent un auteur identifiable', async () => {
  const s = await demarrer();
  try {
    const a = (await s.appel('POST', '/api/coffres', { nom: 'Photos', prenom: 'Alice', codeCreation: CODE })).json;
    const b = (await s.appel('POST', '/api/coffres', { nom: 'Autre', prenom: 'Camille', codeCreation: CODE })).json;
    const route = `/api/coffres/${a.coffreId}`;
    const inv = (await s.appel('POST', route + '/invitations', {}, a.jeton)).json;
    const ami = (await s.appel('POST', '/api/rejoindre', { code: inv.code, prenom: 'Bob' })).json;
    const info = (await s.appel('GET', route, undefined, a.jeton)).json;
    const aliceId = info.moiId;
    const bob = info.membres.find((m: { nom: string }) => m.nom === 'Bob');
    assert.equal(info.membres.find((m: { id: string }) => m.id === aliceId).avatar, null);
    assert.notEqual(aliceId, bob.id);
    assert.equal((await s.appel('PUT', route + '/profil', { avatar: PNG })).statut, 401);
    assert.equal((await s.appel('PUT', `/api/coffres/${b.coffreId}/profil`, { avatar: PNG }, a.jeton)).statut, 403);
    for (const avatar of [PNG, JPEG, WEBP]) {
      const r = await s.appel('PUT', route + '/profil', { avatar, id: bob.id }, a.jeton);
      assert.equal(r.statut, 200);
      assert.deepEqual(r.json, { id: aliceId, nom: 'Alice', avatar });
    }
    let membres = (await s.appel('GET', route, undefined, ami.jeton)).json.membres;
    assert.equal(membres.find((m: { id: string }) => m.id === aliceId).avatar, WEBP);
    assert.equal(membres.find((m: { id: string }) => m.id === bob.id).avatar, null);
    assert.equal((await s.appel('GET', route, undefined, b.jeton)).statut, 403);
    assert.deepEqual((await s.appel('GET', route + '?revision=1', undefined, ami.jeton)).json,
      { id: a.coffreId, nom: 'Photos', rev: 0, presence: [] });
    assert.equal((await s.appel('GET', route + '?revision=1', undefined, b.jeton)).statut, 403);

    const contenu = 'Modification attribuee';
    const hash = sha(contenu);
    await fetch(`${s.url}${route}/blobs/${hash}`, { method: 'PUT', body: contenu, headers: { Authorization: 'Bearer ' + a.jeton } });
    await s.appel('POST', route + '/fichiers', { chemin: 'note.md', hash, base: null }, a.jeton);
    const changement = (await s.appel('GET', route + '/changements', undefined, ami.jeton)).json.changements[0];
    assert.equal(changement.auteurId, aliceId);
    assert.equal(changement.auteur, 'Alice');
    assert.equal('avatar' in changement, false);
    assert.equal((await s.appel('PUT', route + '/profil', { avatar: null }, a.jeton)).statut, 200);
    membres = (await s.appel('GET', route, undefined, ami.jeton)).json.membres;
    assert.equal(membres.find((m: { id: string }) => m.id === aliceId).avatar, null);
    assert.equal((await s.appel('GET', route, undefined, ami.jeton)).json.rev, 1);
    await s.appel('DELETE', route + '/membres/moi', undefined, a.jeton);
    assert.equal((await s.appel('PUT', route + '/profil', { avatar: PNG }, a.jeton)).statut, 403);
    const historique = (await s.appel('GET', route + '/changements', undefined, ami.jeton)).json.changements[0];
    assert.equal(historique.auteurId, aliceId);
    assert.equal(historique.auteur, 'Alice');
  } finally { await s.arreter(); }
});

test('les photos refusent les URL, SVG, faux formats, base64 ambigu et fichiers trop volumineux', async () => {
  const s = await demarrer();
  try {
    const a = (await s.appel('POST', '/api/coffres', { nom: 'Validation', prenom: 'Alice', codeCreation: CODE })).json;
    const route = `/api/coffres/${a.coffreId}/profil`;
    await s.appel('PUT', route, { avatar: PNG }, a.jeton);
    const invalides = [undefined, '', 42, {}, 'https://example.test/photo.png',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/png;base64,SGVsbG8=',
      PNG.replace('image/png', 'image/jpeg'), PNG.replace('base64,', 'base64,\n'),
      PNG.replace(/=+$/, ''), PNG + '=', PNG.replace('II=', 'IJ=')];
    for (const avatar of invalides) {
      assert.equal((await s.appel('PUT', route, { avatar }, a.jeton)).statut, 400, String(avatar));
    }
    assert.equal((await s.appel('PUT', route, null, a.jeton)).statut, 400);
    const gros = Buffer.alloc(32 * 1024 + 1); Buffer.from(PNG.split(',')[1], 'base64').copy(gros);
    assert.equal((await s.appel('PUT', route, { avatar: 'data:image/png;base64,' + gros.toString('base64') }, a.jeton)).statut, 413);
    const info = (await s.appel('GET', `/api/coffres/${a.coffreId}`, undefined, a.jeton)).json;
    assert.equal(info.membres[0].avatar, PNG);
  } finally { await s.arreter(); }
});

test('le nom et la photo de son profil se modifient séparément ou ensemble sans écriture partielle', async () => {
  const s = await demarrer();
  try {
    const a = (await s.appel('POST', '/api/coffres', { nom: 'Profils', prenom: 'Alice', codeCreation: CODE })).json;
    const autre = (await s.appel('POST', '/api/coffres', { nom: 'Autre', prenom: 'Camille', codeCreation: CODE })).json;
    const coffre = `/api/coffres/${a.coffreId}`;
    const route = coffre + '/profil';
    const inv = (await s.appel('POST', coffre + '/invitations', {}, a.jeton)).json;
    const ami = (await s.appel('POST', '/api/rejoindre', { code: inv.code, prenom: 'Bob' })).json;
    const info = (await s.appel('GET', coffre, undefined, a.jeton)).json;
    const id = info.moiId;
    const bobId = info.membres.find((m: { nom: string }) => m.nom === 'Bob').id;
    const lire = async () => (await s.appel('GET', coffre, undefined, a.jeton)).json;
    const profilAttendu = (nom: string, avatar: string | null) => ({ id, nom, avatar });
    assert.equal((await s.appel('PUT', route, { nom: 'Autre nom' })).statut, 401);
    assert.equal((await s.appel('PUT', route, { nom: 'Autre nom' }, autre.jeton)).statut, 403);

    assert.deepEqual((await s.appel('PUT', route, { avatar: PNG }, a.jeton)).json, profilAttendu('Alice', PNG));
    const contenu = 'Un changement avant renommage';
    const hash = sha(contenu);
    await fetch(`${s.url}${coffre}/blobs/${hash}`, { method: 'PUT', body: contenu, headers: { Authorization: 'Bearer ' + a.jeton } });
    await s.appel('POST', coffre + '/fichiers', { chemin: 'note.md', hash, base: null }, a.jeton);
    assert.deepEqual((await s.appel('PUT', route, { nom: '  Alex  ', id: bobId }, a.jeton)).json, profilAttendu('Alex', PNG));
    let membres = await lire();
    assert.equal(membres.moi, 'Alex');
    assert.equal(membres.membres.find((m: { id: string }) => m.id === bobId).nom, 'Bob');
    const changement = (await s.appel('GET', coffre + '/changements', undefined, ami.jeton)).json.changements[0];
    assert.equal(changement.auteur, 'Alex');
    assert.equal(changement.auteurId, id);
    assert.deepEqual((await s.appel('PUT', route, { avatar: JPEG }, a.jeton)).json, profilAttendu('Alex', JPEG));
    assert.deepEqual((await s.appel('PUT', route, { nom: '  Sam  ', avatar: WEBP }, a.jeton)).json, profilAttendu('Sam', WEBP));

    for (const corps of [{}, { id: bobId }, null, [], { nom: '' }, { nom: '   ' }, { nom: null }, { nom: 42 }, { nom: 'a'.repeat(61) },
      { nom: '', avatar: PNG }, { nom: 'Nom refuse', avatar: 'https://example.test/photo.jpg' }]) {
      assert.equal((await s.appel('PUT', route, corps, a.jeton)).statut, 400, JSON.stringify(corps));
      membres = await lire();
      assert.equal(membres.moi, 'Sam');
      assert.equal(membres.membres.find((m: { id: string }) => m.id === id).avatar, WEBP);
    }
    assert.deepEqual((await s.appel('PUT', route, { nom: 'a'.repeat(60) }, a.jeton)).json, profilAttendu('a'.repeat(60), WEBP));
    assert.deepEqual((await s.appel('PUT', route, { nom: 'Z', avatar: null }, a.jeton)).json, profilAttendu('Z', null));
    await s.appel('DELETE', coffre + '/membres/moi', undefined, a.jeton);
    assert.equal((await s.appel('PUT', route, { nom: 'Interdit' }, a.jeton)).statut, 403);
  } finally { await s.arreter(); }
});

test('les dossiers vides utilisent une révision conditionnelle et ne remplacent aucun fichier', async () => {
  const s = await demarrer();
  try {
    const a = (await s.appel('POST', '/api/coffres', { nom: 'Dossiers', prenom: 'Alice', codeCreation: CODE })).json;
    const b = (await s.appel('POST', '/api/coffres', { nom: 'Autre', prenom: 'Bob', codeCreation: CODE })).json;
    const route = `/api/coffres/${a.coffreId}`;
    const dossier = (chemin: string, supprime = false, baseRev: number | null = null) => s.appel('POST', route + '/dossiers', { chemin, supprime, baseRev }, a.jeton);
    assert.equal((await s.appel('POST', route + '/dossiers', { chemin: 'Vide', supprime: false, baseRev: null })).statut, 401);
    assert.equal((await s.appel('POST', route + '/dossiers', { chemin: 'Vide', supprime: false, baseRev: null }, b.jeton)).statut, 403);
    for (const corps of [null, { chemin: '../non', supprime: false, baseRev: null }, { chemin: 'Vide', supprime: 0, baseRev: null },
      { chemin: 'Vide', supprime: false }, { chemin: 'Vide', supprime: false, baseRev: 0 }, { chemin: 'Vide', supprime: false, baseRev: 1.5 }]) {
      assert.equal((await s.appel('POST', route + '/dossiers', corps, a.jeton)).statut, 400);
    }
    const vide = await dossier('Vide');
    assert.equal(vide.statut, 200);
    assert.equal(vide.json.rev, 1);
    await dossier('Autre dossier');
    assert.deepEqual((await dossier('Vide')).json, { rev: 1, inchange: true });
    assert.equal((await dossier('Vide', true, 999)).statut, 409);
    const supprime = await dossier('Vide', true, 1);
    assert.equal(supprime.statut, 200);
    assert.deepEqual((await dossier('Vide', true, 1)).json, { rev: supprime.json.rev, inchange: true });
    assert.equal((await dossier('Vide', false, 1)).statut, 409);
    const recree = await dossier('Vide');
    assert.equal(recree.statut, 200);
    const info = (await s.appel('GET', route + '/changements', undefined, a.jeton)).json;
    const histoire = info.changements.filter((c: { chemin: string }) => c.chemin === 'Vide');
    assert.deepEqual(histoire.map((c: { type: string; supprime: boolean; hash: string | null }) => [c.type, c.supprime, c.hash]),
      [['dossier', false, null], ['dossier', true, null], ['dossier', false, null]]);

    const contenu = 'Le fichier reste intact';
    const h = sha(contenu);
    await fetch(`${s.url}${route}/blobs/${h}`, { method: 'PUT', body: contenu, headers: { Authorization: 'Bearer ' + a.jeton } });
    assert.equal((await s.appel('POST', route + '/fichiers', { chemin: 'Vide', hash: h, base: null }, a.jeton)).statut, 409);
    const fichier = await ecrireVersion(s, a.coffreId, a.jeton, 'occupe', contenu);
    assert.equal((await dossier('occupe')).statut, 409);
    assert.equal((await dossier('occupe', true)).statut, 409);
    assert.equal((await dossier('occupe/enfant')).statut, 409);
    assert.equal((await s.appel('POST', route + '/fichiers', { chemin: 'occupe/enfant.md', hash: h, base: null }, a.jeton)).statut, 409);
    assert.equal(fichier.hash, h);

    const parent = await dossier('Étage_%');
    const enfant = await dossier('Étage_%/Vide');
    assert.equal((await dossier('Étage_%', true, parent.json.rev)).statut, 409);
    assert.equal((await dossier('Étage_%/Vide', true, enfant.json.rev)).statut, 200);
    const note = await ecrireVersion(s, a.coffreId, a.jeton, 'Étage_%/note.md', 'Une note');
    assert.equal((await dossier('Étage_%', true, parent.json.rev)).statut, 409);
    await ecrireVersion(s, a.coffreId, a.jeton, 'Étage_%/note.md', null, note.hash);
    assert.equal((await dossier('Étage_%', true, parent.json.rev)).statut, 200);

    const implicite = await ecrireVersion(s, a.coffreId, a.jeton, 'Implicite/note.md', 'Dossier ancien client');
    assert.equal((await dossier('Implicite', true)).statut, 409);
    assert.equal((await s.appel('POST', route + '/fichiers', { chemin: 'Implicite', hash: h, base: null }, a.jeton)).statut, 409);
    await ecrireVersion(s, a.coffreId, a.jeton, 'Implicite/note.md', null, implicite.hash);
    assert.equal((await dossier('Implicite', true)).statut, 200);
    const comparaison = (await s.appel('GET', route + `/revisions/${recree.json.rev}`, undefined, a.jeton)).json;
    assert.equal(comparaison.raison, 'dossier');
    assert.equal(comparaison.avant, null);
    assert.equal(comparaison.apres, null);
  } finally { await s.arreter(); }
});

test('les révisions comparent exactement les versions et bornent les aperçus de texte', async () => {
  const s = await demarrer();
  try {
    const a = (await s.appel('POST', '/api/coffres', { nom: 'Versions', prenom: 'Alice', codeCreation: CODE })).json;
    const b = (await s.appel('POST', '/api/coffres', { nom: 'Autre', prenom: 'Bob', codeCreation: CODE })).json;
    const route = `/api/coffres/${a.coffreId}`;
    const revision = (rev: number) => s.appel('GET', route + `/revisions/${rev}`, undefined, a.jeton);
    const avant = '# Note\n<script>contenu littéral</script>\n';
    const apres = '# Note\nDu texte corrigé\n';
    const v1 = await ecrireVersion(s, a.coffreId, a.jeton, 'note.md', avant);
    await ecrireVersion(s, a.coffreId, a.jeton, 'autre.txt', 'Intermédiaire');
    const v2 = await ecrireVersion(s, a.coffreId, a.jeton, 'note.md', apres, v1.hash);
    let lu = await revision(v2.rev);
    assert.equal(lu.statut, 200);
    assert.equal(lu.json.raison, null);
    assert.equal(lu.json.avant, avant);
    assert.equal(lu.json.apres, apres);
    assert.equal(lu.json.changement.avantHash, v1.hash);
    assert.equal(lu.json.changement.type, 'fichier');
    const v3 = await ecrireVersion(s, a.coffreId, a.jeton, 'note.md', null, v2.hash);
    lu = await revision(v3.rev);
    assert.equal(lu.json.avant, apres);
    assert.equal(lu.json.apres, null);
    const v4 = await ecrireVersion(s, a.coffreId, a.jeton, 'note.md', 'Recréée');
    lu = await revision(v4.rev);
    assert.equal(lu.json.changement.avantHash, null);
    assert.equal(lu.json.avant, null);
    assert.equal(lu.json.apres, 'Recréée');
    const ancienne = await revision(v2.rev);
    assert.equal(ancienne.json.avant, avant);
    assert.equal(ancienne.json.apres, apres);

    const pile = await ecrireVersion(s, a.coffreId, a.jeton, 'taille.csv', 'a'.repeat(256 * 1024));
    assert.equal((await revision(pile.rev)).json.apres.length, 256 * 1024);
    const trop = await ecrireVersion(s, a.coffreId, a.jeton, 'taille.csv', 'b'.repeat(256 * 1024 + 1), pile.hash);
    assert.deepEqual([(await revision(trop.rev)).json.raison, (await revision(trop.rev)).json.apres], ['volumineux', null]);
    const retour = await ecrireVersion(s, a.coffreId, a.jeton, 'taille.csv', 'Petit', trop.hash);
    lu = await revision(retour.rev);
    assert.deepEqual([lu.json.raison, lu.json.avant, lu.json.apres], ['volumineux', null, null]);
    for (const [chemin, contenu] of [['document.pdf', 'PDF'], ['page.html', '<script>alerte</script>'],
      ['binaire.md', Buffer.from([1, 0, 2])], ['invalide.txt', Buffer.from([195, 40])]] as Array<[string, string | Buffer]>) {
      const v = await ecrireVersion(s, a.coffreId, a.jeton, chemin, contenu);
      lu = await revision(v.rev);
      assert.deepEqual([lu.json.raison, lu.json.avant, lu.json.apres], ['binaire', null, null]);
    }
    assert.equal((await revision(99999)).statut, 404);
    assert.equal((await revision(0)).statut, 400);
    assert.equal((await s.appel('GET', route + `/revisions/${v1.rev}`)).statut, 401);
    assert.equal((await s.appel('GET', route + `/revisions/${v1.rev}`, undefined, b.jeton)).statut, 403);
    assert.equal((await s.appel('GET', `/api/coffres/${b.coffreId}/revisions/${v1.rev}`, undefined, a.jeton)).statut, 403);
  } finally { await s.arreter(); }
});

test('l’activité est récente, filtrable par identifiant et limitée sans exposer un autre coffre', async () => {
  const s = await demarrer();
  try {
    const a = (await s.appel('POST', '/api/coffres', { nom: 'Activité', prenom: 'Alice', codeCreation: CODE })).json;
    const b = (await s.appel('POST', '/api/coffres', { nom: 'Privé', prenom: 'Camille', codeCreation: CODE })).json;
    const route = `/api/coffres/${a.coffreId}`;
    const inv = (await s.appel('POST', route + '/invitations', {}, a.jeton)).json;
    const ami = (await s.appel('POST', '/api/rejoindre', { code: inv.code, prenom: 'Bob' })).json;
    const amiId = (await s.appel('GET', route, undefined, ami.jeton)).json.moiId;
    const autreId = (await s.appel('GET', `/api/coffres/${b.coffreId}`, undefined, b.jeton)).json.moiId;
    await s.appel('PUT', route + '/profil', { avatar: PNG }, ami.jeton);
    const note = await ecrireVersion(s, a.coffreId, a.jeton, 'note.md', 'Alice écrit');
    const bob = await ecrireVersion(s, a.coffreId, ami.jeton, 'note.md', 'Bob corrige', note.hash);
    for (let i = 0; i < 105; i++) assert.equal((await s.appel('POST', route + '/dossiers',
      { chemin: 'Vide-' + i, supprime: false, baseRev: null }, a.jeton)).statut, 200);
    const activite = (query = '') => s.appel('GET', route + '/activite' + query, undefined, a.jeton);
    let reponse = (await activite()).json;
    assert.equal(reponse.changements.length, 40);
    assert.equal(reponse.plus, true);
    assert.ok(reponse.changements.every((c: { rev: number }, i: number, liste: Array<{ rev: number }>) => i === 0 || c.rev < liste[i - 1].rev));
    assert.equal(reponse.membres.find((m: { id: string }) => m.id === amiId).avatar, PNG);
    assert.equal(reponse.membres.some((m: { id: string }) => m.id === autreId), false);
    assert.equal((await activite('?limite=9999')).json.changements.length, 100);
    reponse = (await activite('?limite=2')).json;
    assert.equal(reponse.changements.length, 2);
    reponse = (await activite('?auteur=' + amiId)).json;
    assert.equal(reponse.changements.length, 1);
    assert.equal(reponse.changements[0].rev, bob.rev);
    assert.equal(reponse.changements[0].avantHash, note.hash);
    assert.equal(reponse.changements[0].auteurId, amiId);
    assert.equal(reponse.plus, false);
    assert.deepEqual((await activite('?auteur=' + autreId)).json.changements, []);
    assert.equal((await activite('?auteur=%27%20OR%201%3D1')).statut, 400);
    assert.equal((await s.appel('GET', route + '/activite')).statut, 401);
    assert.equal((await s.appel('GET', route + '/activite', undefined, b.jeton)).statut, 403);
    assert.deepEqual(Object.keys((await s.appel('GET', route + '?revision=1', undefined, a.jeton)).json).sort(), ['id', 'nom', 'presence', 'rev']);
  } finally { await s.arreter(); }
});

test('la migration des anciens membres préserve les jetons et les photos après redémarrage', async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'cordee-migration-profils-'));
  const base = path.join(dossier, 'cordee.db');
  const ancien = new DatabaseSync(base);
  ancien.exec(`CREATE TABLE coffres (id TEXT PRIMARY KEY, nom TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 0, cree_le INTEGER NOT NULL);
    CREATE TABLE membres (id TEXT PRIMARY KEY, coffre_id TEXT NOT NULL, nom TEXT NOT NULL,
      jeton_hash TEXT NOT NULL UNIQUE, cree_le INTEGER NOT NULL, revoque INTEGER NOT NULL DEFAULT 0);`);
  ancien.prepare('INSERT INTO coffres VALUES (?, ?, ?, ?)').run('coffre-test', 'Ancien coffre', 7, 1);
  ancien.prepare('INSERT INTO membres VALUES (?, ?, ?, ?, ?, ?)').run('membre-test', 'coffre-test', 'Alice', sha('jeton-fictif'), 1, 0);
  ancien.close();
  let instance: ReturnType<typeof creerServeur> | undefined;
  let vuLe: number | null = null;
  try {
    for (let tour = 0; tour < 3; tour++) {
      instance = creerServeur({ dossierDonnees: dossier, codeCreation: CODE });
      await new Promise<void>((ok) => instance!.serveur.listen(0, '127.0.0.1', () => ok()));
      const url = `http://127.0.0.1:${(instance.serveur.address() as AddressInfo).port}/api/coffres/coffre-test`;
      const headers = { Authorization: 'Bearer jeton-fictif', 'Content-Type': 'application/json' };
      const info = await (await fetch(url, { headers })).json();
      assert.equal(info.rev, 7);
      assert.equal(info.moiId, 'membre-test');
      assert.equal(info.membres[0].avatar, tour === 0 ? null : PNG);
      assert.equal(info.membres[0].vu_le, tour === 1 ? vuLe : null, 'la date visible et le masquage survivent aux redémarrages');
      if (tour === 0) {
        assert.equal((await fetch(url + '/profil', { method: 'PUT', headers, body: JSON.stringify({ avatar: PNG }) })).status, 200);
        await fetch(url + '/presence', { method: 'POST', headers, body: JSON.stringify({ chemin: null }) });
        vuLe = (await (await fetch(url, { headers })).json()).membres[0].vu_le;
        assert.ok(vuLe! > 0);
        await fetch(url + '/presence', { method: 'POST', headers, body: JSON.stringify({ parti: true }) });
      }
      if (tour === 1) await fetch(url + '/presence', { method: 'POST', headers, body: JSON.stringify({ parti: true, masquee: true }) });
      const fermeture = new Promise<void>((ok) => instance!.serveur.once('close', () => ok()));
      instance.fermer(); instance = undefined;
      await fermeture;
    }
  } finally {
    instance?.fermer();
    assert.equal(path.dirname(path.resolve(dossier)), path.resolve(os.tmpdir()));
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test("le serveur retient la version de l'extension de chaque membre, sans accepter n'importe quoi", async () => {
  const s = await demarrer();
  try {
    const c = (await s.appel('POST', '/api/coffres', { nom: 'V', prenom: 'Alice', codeCreation: CODE })).json;
    const code = (await s.appel('POST', `/api/coffres/${c.coffreId}/invitations`, {}, c.jeton)).json.code;
    const b = (await s.appel('POST', '/api/rejoindre', { code, prenom: 'Bruno' })).json;
    const avec = (jeton: string, version: string) => fetch(s.url + `/api/coffres/${c.coffreId}`, { headers: { Authorization: 'Bearer ' + jeton, 'X-Cordee-Version': version } });
    await avec(c.jeton, '0.1.5');
    await avec(b.jeton, '<script>alert(1)</script>');
    const info = (await s.appel('GET', `/api/coffres/${c.coffreId}`, undefined, c.jeton)).json;
    const parNom = Object.fromEntries(info.membres.map((m: { nom: string; version: string | null }) => [m.nom, m.version]));
    assert.equal(parNom.Alice, '0.1.5');
    assert.equal(parNom.Bruno, null, 'une extension ancienne ou une valeur invalide reste « inconnue »');
    await avec(b.jeton, '0.1.4');
    const apres = (await s.appel('GET', `/api/coffres/${c.coffreId}`, undefined, c.jeton)).json;
    assert.equal(apres.membres.find((m: { nom: string }) => m.nom === 'Bruno').version, '0.1.4');
  } finally { await s.arreter(); }
});

test("présence : chacun voit quelle note les autres ont ouverte, et elle s'efface quand on part", async () => {
  const s = await demarrer();
  try {
    const c = (await s.appel('POST', '/api/coffres', { nom: 'P', prenom: 'Alice', codeCreation: CODE })).json;
    const code = (await s.appel('POST', `/api/coffres/${c.coffreId}/invitations`, {}, c.jeton)).json.code;
    const b = (await s.appel('POST', '/api/rejoindre', { code, prenom: 'Bruno' })).json;
    const route = `/api/coffres/${c.coffreId}`;
    assert.equal((await s.appel('POST', route + '/presence', { chemin: '../secret' }, b.jeton)).statut, 400);
    assert.equal((await s.appel('POST', route + '/presence', { chemin: 'Cours/TD.md' }, b.jeton)).statut, 200);
    const vu = (await s.appel('GET', route + '?revision=1', undefined, c.jeton)).json;
    assert.deepEqual(vu.presence.map((p: { nom: string; chemin: string }) => [p.nom, p.chemin]), [['Bruno', 'Cours/TD.md']]);
    // On ne se voit pas soi-même.
    assert.deepEqual((await s.appel('GET', route + '?revision=1', undefined, b.jeton)).json.presence, []);
    await s.appel('POST', route + '/presence', { parti: true }, b.jeton);
    assert.deepEqual((await s.appel('GET', route + '?revision=1', undefined, c.jeton)).json.presence, []);
    assert.equal((await s.appel('POST', route + '/presence', { chemin: 'x.md' })).statut, 401);
  } finally { await s.arreter(); }
});

test('dernière activité : dates espacées de 30 s, expiration et confidentialité après départ', async (t) => {
  const s = await demarrer();
  let horloge = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => horloge);
  try {
    const a = (await s.appel('POST', '/api/coffres', { nom: 'Présence', prenom: 'Alice', codeCreation: CODE })).json;
    const route = `/api/coffres/${a.coffreId}`;
    const code = (await s.appel('POST', route + '/invitations', {}, a.jeton)).json.code;
    const b = (await s.appel('POST', '/api/rejoindre', { code, prenom: 'Bruno' })).json;
    const voir = async () => (await s.appel('GET', route, undefined, a.jeton)).json.membres.find((m: { nom: string }) => m.nom === 'Bruno').vu_le;
    const annoncer = (corps: unknown) => s.appel('POST', route + '/presence', corps, b.jeton);
    assert.equal(await voir(), null);
    await annoncer({ chemin: '../secret.md' });
    assert.equal(await voir(), null, 'une annonce invalide ne constitue pas une activité');
    await annoncer({ chemin: null });
    const premiere = horloge;
    assert.equal(await voir(), premiere);
    horloge += 29_999;
    await annoncer({ chemin: 'Cours.md' });
    assert.equal(await voir(), premiere);
    horloge++;
    await annoncer({ chemin: null });
    const derniere = horloge;
    assert.equal(await voir(), derniere, 'la limite de 30 s est incluse');
    horloge += 90_001;
    assert.deepEqual((await s.appel('GET', route + '?revision=1', undefined, a.jeton)).json.presence, []);
    assert.equal(await voir(), derniere, 'la date reste disponible après expiration');
    await s.appel('GET', route + '?revision=1', undefined, b.jeton);
    assert.equal(await voir(), derniere, 'les sondages seuls ne révèlent pas une activité cachée');
    await annoncer({ parti: true });
    assert.equal(await voir(), derniere, 'fermer Obsidian conserve la dernière visite');
    await annoncer({ parti: true, masquee: true });
    assert.equal(await voir(), null, 'masquer sa présence masque aussi la date précédente');
    assert.equal((await s.appel('GET', route + '/activite', undefined, a.jeton)).json.membres.find((m: { nom: string }) => m.nom === 'Bruno').vu_le, null);
    horloge += 60_000;
    await annoncer({ parti: true });
    assert.equal(await voir(), null, 'une fermeture ne réactive pas la visibilité');
    await annoncer({ chemin: null });
    assert.equal(await voir(), horloge, 'une nouvelle annonce visible réactive la date');
  } finally { t.mock.restoreAll(); await s.arreter(); }
});

test("historique d'une note : ses versions de la plus récente à la plus ancienne, et seulement elle", async () => {
  const s = await demarrer();
  try {
    const c = (await s.appel('POST', '/api/coffres', { nom: 'H', prenom: 'Alice', codeCreation: CODE })).json;
    const route = `/api/coffres/${c.coffreId}`;
    const ecrire = async (chemin: string, texte: string, base: string | null) => {
      const h = sha(texte);
      await fetch(s.url + route + '/blobs/' + h, { method: 'PUT', headers: { Authorization: 'Bearer ' + c.jeton }, body: texte });
      await s.appel('POST', route + '/fichiers', { chemin, hash: h, base }, c.jeton);
      return h;
    };
    const v1 = await ecrire('a.md', 'un', null);
    await ecrire('b.md', 'autre', null);
    const v2 = await ecrire('a.md', 'deux', v1);
    const h = (await s.appel('GET', route + '/historique?chemin=a.md', undefined, c.jeton)).json;
    assert.deepEqual(h.changements.map((x: { hash: string }) => x.hash), [v2, v1]);
    assert.equal(h.changements[0].avantHash, v1);
    assert.equal(h.changements[0].auteur, 'Alice');
    assert.equal((await s.appel('GET', route + '/historique?chemin=..%2Fx', undefined, c.jeton)).statut, 400);
  } finally { await s.arreter(); }
});
