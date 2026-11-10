// Tests de l'API : création, invitation, accès, écriture conditionnelle, sécurité des chemins.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { demarrer, CODE } from './outils.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
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
