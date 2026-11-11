// Réponses fictives de l’API mobile Moodle : aucun accès au réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { nomMoodle, dossierMoodle, siteMoodle, fichiersMoodle, doitTelechargerMoodle, modificationLocaleMoodle, copieMoodle, indexMoodle } = require('../main.js').interne;
const fichier = (autre = {}) => ({ type: 'file', filename: 'cours.pdf', filepath: '/', fileurl: 'https://moodle.exemple.fr/webservice/pluginfile.php/12/cours.pdf', filesize: 120, timemodified: 17, ...autre });
const sections = [{ id: 1, name: 'TD / TP', modules: [
  { id: 10, modname: 'resource', contents: [fichier()] },
  { id: 11, modname: 'folder', contents: [fichier({ filepath: '/Mes TD/' }), fichier({ filename: 'sujet.pdf' })] },
  { id: 12, modname: 'assign', contents: [fichier({ filename: 'copie-personnelle.pdf' })] },
  { id: 13, modname: 'url', contents: [{ type: 'url', fileurl: 'https://exemple.fr' }] },
] }];

test('Moodle : noms portables sous Windows et compatibles avec les liens internes', () => {
  for (const valeur of ['..', '../cours', 'a\\b/c:*?"<>|', 'a\0b', 'cours[[1]]#^', 'x...pdf', 'NUL.pdf', 'con', 'LPT1.txt']) {
    const nom = nomMoodle(valeur);
    assert.doesNotMatch(nom, /\.\.|[\x00-\x1f<>:"/\\|?*\[\]#^]/);
    assert.doesNotMatch(nom, /^[. ]|[. ]$/);
    assert.doesNotMatch(nom, /^(con|nul|lpt1)(?:\.|$)/i);
  }
  assert.equal(nomMoodle('Énergie'), 'Énergie');
  assert.equal(nomMoodle(''), 'Sans nom');
  assert.ok(nomMoodle('a'.repeat(200)).length <= 100);
});

test('Moodle : destinations relatives nettoyées, traversées et sites sans HTTPS refusés', () => {
  assert.equal(dossierMoodle('Moodle\\ENER3/TD:1'), 'Moodle/ENER3/TD-1');
  for (const valeur of ['', '../Perso', 'Moodle/../Perso', 'Moodle/./TD']) assert.throws(() => dossierMoodle(valeur));
  assert.equal(siteMoodle('https://moodle.exemple.fr/campus/'), 'https://moodle.exemple.fr/campus');
  for (const valeur of ['http://moodle.exemple.fr', 'https://agent-local@moodle.exemple.fr', 'https://moodle.exemple.fr/?token=factice', 'pas un site']) assert.throws(() => siteMoodle(valeur));
});

test('Moodle : seules les ressources et dossiers sont pris, avec leurs sous-dossiers', () => {
  const fichiers = fichiersMoodle(sections, 'Moodle/ENER3', 3);
  assert.deepEqual(fichiers.map((f) => f.chemin), ['Moodle/ENER3/TD - TP/cours.pdf', 'Moodle/ENER3/TD - TP/Mes TD/cours.pdf', 'Moodle/ENER3/TD - TP/sujet.pdf']);
  assert.equal(new Set(fichiers.map((f) => f.cle)).size, 3);
  assert.equal(fichiers[0].filesize, 120);
});

test('Moodle : des noms identiques ou qui ne diffèrent que par la casse gardent deux fichiers', () => {
  const s = [{ id: 1, name: 'TD', modules: [{ id: 1, modname: 'folder', contents: [fichier(), fichier({ filename: 'COURS.pdf' })] }] }, { id: 2, name: 'td', modules: [{ id: 2, modname: 'resource', contents: [fichier()] }] }];
  const chemins = fichiersMoodle(s, 'Moodle/ENER3', 3).map((f) => f.chemin.toLowerCase());
  assert.equal(new Set(chemins).size, 3);
  assert.equal(chemins[1], 'moodle/ener3/td/cours (moodle).pdf');
  assert.equal(chemins[2], 'moodle/ener3/td (2)/cours.pdf');
});

test('Moodle : métadonnées identiques ignorées, ajout, changement, suppression locale et déplacement récupérés', () => {
  const f = fichiersMoodle(sections, 'Moodle/ENER3', 3)[0];
  const avant = { source: f.chemin, timemodified: f.timemodified, filesize: f.filesize };
  assert.equal(doitTelechargerMoodle(f, avant), false);
  assert.equal(doitTelechargerMoodle(f, null), true);
  assert.equal(doitTelechargerMoodle(f, avant, false), true);
  assert.equal(doitTelechargerMoodle({ ...f, timemodified: 18 }, avant), true);
  assert.equal(doitTelechargerMoodle({ ...f, filesize: 121 }, avant), true);
  assert.equal(doitTelechargerMoodle({ ...f, chemin: 'Autre/cours.pdf' }, avant), true);
  assert.equal(doitTelechargerMoodle({ ...f, filesize: 50 * 1024 * 1024 }, null), true);
  assert.equal(doitTelechargerMoodle({ ...f, filesize: 50 * 1024 * 1024 + 1 }, null), false);
});

test('Moodle : une empreinte différente ou inconnue protège le fichier local', () => {
  assert.equal(modificationLocaleMoodle({ hash: 'abc' }, 'abc'), false);
  assert.equal(modificationLocaleMoodle({ hash: 'abc' }, 'autre'), true);
  assert.equal(modificationLocaleMoodle(null, 'abc'), true);
  assert.equal(modificationLocaleMoodle({ hash: 'abc' }, null), false);
  assert.equal(copieMoodle('Moodle/TD/cours.pdf'), 'Moodle/TD/cours (Moodle).pdf');
  assert.equal(copieMoodle('Moodle/TD/cours.pdf', 2), 'Moodle/TD/cours (Moodle 2).pdf');
  assert.equal(copieMoodle('Moodle/TD/cours'), 'Moodle/TD/cours (Moodle)');
});

test('Moodle : index avec sections et liens locaux, sans URL ou jeton Moodle', () => {
  const fichiers = fichiersMoodle(sections, 'Moodle/ENER3', 3);
  const f = fichiers[0], cache = { [f.cle]: { source: f.chemin, chemin: copieMoodle(f.chemin) } };
  const index = indexMoodle({ fullname: 'ENER3' }, sections, fichiers, cache);
  assert.match(index, /## TD - TP/);
  assert.ok(index.includes('[[Moodle/ENER3/TD - TP/cours (Moodle).pdf|cours.pdf]]'));
  assert.match(index, /sujet.pdf — pas encore récupéré/);
  assert.doesNotMatch(index, /https:|fileurl|wstoken/);
});
