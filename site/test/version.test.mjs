// Le site annonce la version de l'extension : elle doit être celle du manifeste publié,
// sinon le site promet une mise à jour qui n'existe pas (ou en cache une qui existe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('la version affichée par le site est celle du manifeste de l’extension', () => {
  const manifeste = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const source = readFileSync(new URL('../src/lib/extension.ts', import.meta.url), 'utf8');
  const site = source.match(/VERSION_EXTENSION = "([0-9.]+)"/)?.[1];
  assert.equal(site, manifeste.version);
  const derniere = source.match(/version: "([0-9.]+)"/)?.[1];
  assert.equal(derniere, manifeste.version, 'la première entrée des nouveautés doit être la version actuelle');
});
