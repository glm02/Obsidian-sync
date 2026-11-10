// Tests de la fusion à trois versions et des petits outils de l'extension.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fusionner, lireInvitation, nomCopieConflit } = require('../main.js').interne;

test('deux modifications à des endroits différents se combinent', () => {
  const base = 'titre\nligne 1\nligne 2\nligne 3';
  const locale = 'titre\nligne 1 modifiée ici\nligne 2\nligne 3';
  const distante = 'titre\nligne 1\nligne 2\nligne 3 modifiée là-bas';
  const r = fusionner(base, locale, distante);
  assert.equal(r.texte, 'titre\nligne 1 modifiée ici\nligne 2\nligne 3 modifiée là-bas');
  assert.equal(r.conflit, false);
});

test('la même ligne modifiée différemment : les deux versions sont gardées', () => {
  const r = fusionner('a\nb\nc', 'a\nB local\nc', 'a\nB distant\nc');
  assert.equal(r.texte, 'a\nB local\nB distant\nc');
  assert.equal(r.conflit, true);
});

test('la même modification des deux côtés ne se répète pas', () => {
  const r = fusionner('a\nb', 'a\nb\nc', 'a\nb\nc');
  assert.equal(r.texte, 'a\nb\nc');
  assert.equal(r.conflit, false);
});

test('sans base commune (deux coffres réunis), on garde tout', () => {
  const r = fusionner('', 'note de Rafaël', 'note de Paul');
  assert.equal(r.conflit, true);
  assert.match(r.texte, /Rafaël/);
  assert.match(r.texte, /Paul/);
});

test('suppression de lignes d\'un côté, ajout de l\'autre', () => {
  const r = fusionner('1\n2\n3\n4', '1\n3\n4', '1\n2\n3\n4\n5');
  assert.equal(r.texte, '1\n3\n4\n5');
  assert.equal(r.conflit, false);
});

test('lecture d\'un lien d\'invitation', () => {
  assert.deepEqual(lireInvitation('https://cordee.exemple.fr/rejoindre/ABCD-EFGH-JKLM'), { serveur: 'https://cordee.exemple.fr', code: 'ABCD-EFGH-JKLM' });
  assert.deepEqual(lireInvitation(' ABCD-EFGH-JKLM ', 'http://x'), { serveur: 'http://x', code: 'ABCD-EFGH-JKLM' });
});

test('nom de copie en conflit garde l\'extension', () => {
  assert.match(nomCopieConflit('images/schema.png', 'Paul'), /^images\/schema \(conflit Paul .+\)\.png$/);
});
