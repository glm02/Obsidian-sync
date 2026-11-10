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
      { id: a.coffreId, nom: 'Photos', rev: 0 });
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
  try {
    for (let tour = 0; tour < 2; tour++) {
      instance = creerServeur({ dossierDonnees: dossier, codeCreation: CODE });
      await new Promise<void>((ok) => instance!.serveur.listen(0, '127.0.0.1', () => ok()));
      const url = `http://127.0.0.1:${(instance.serveur.address() as AddressInfo).port}/api/coffres/coffre-test`;
      const headers = { Authorization: 'Bearer jeton-fictif', 'Content-Type': 'application/json' };
      const info = await (await fetch(url, { headers })).json();
      assert.equal(info.rev, 7);
      assert.equal(info.moiId, 'membre-test');
      assert.equal(info.membres[0].avatar, tour === 0 ? null : PNG);
      if (tour === 0) assert.equal((await fetch(url + '/profil', { method: 'PUT', headers, body: JSON.stringify({ avatar: PNG }) })).status, 200);
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
