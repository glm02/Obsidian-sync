// Réponses fictives de l’API mobile Moodle : aucun accès au réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { nomMoodle, dossierMoodle, siteMoodle, lienConnexionMoodle, jetonDepuisLienMoodle, fichiersMoodle, doitTelechargerMoodle, modificationLocaleMoodle, copieMoodle, indexMoodle, markdownMoodle, devoirMoodle, noteAnnoncesMoodle } = require('../main.js').interne;
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

test('Moodle : une page de connexion donne la racine du site et conserve son sous-dossier', () => {
  for (const base of ['https://moodle.exemple.fr', 'https://moodle.exemple.fr/campus']) {
    for (const fin of ['/login/index.php', '/login/index.php/', '/index.php']) {
      assert.equal(siteMoodle(`  ${base}${fin}  `), base);
    }
    assert.throws(() => siteMoodle(base + '/login/index.php?token=factice'));
  }
});

test('Moodle : seules les ressources et dossiers sont pris, avec leurs sous-dossiers', () => {
  const fichiers = fichiersMoodle(sections, 'Moodle/ENER3', 3);
  assert.deepEqual(fichiers.map((f) => f.chemin), ['Moodle/ENER3/TD - TP/cours.pdf', 'Moodle/ENER3/TD - TP/Mes TD/cours.pdf', 'Moodle/ENER3/TD - TP/sujet.pdf']);
  assert.equal(new Set(fichiers.map((f) => f.cle)).size, 3);
  assert.equal(fichiers[0].filesize, 120);
});

test('Moodle : connexion navigateur sur le site choisi avec un passeport aléatoire sans identifiant personnel', () => {
  const url = new URL(lienConnexionMoodle('https://moodle.exemple.fr/campus/login/index.php'));
  assert.equal(url.origin + url.pathname, 'https://moodle.exemple.fr/campus/admin/tool/mobile/launch.php');
  assert.equal(url.searchParams.get('service'), 'moodle_mobile_app');
  assert.equal(url.searchParams.get('urlscheme'), 'cordee-moodle');
  assert.equal(url.searchParams.get('confirmed'), '1');
  assert.match(url.searchParams.get('passport'), /^[a-f0-9]{48}$/);
  assert.notEqual(url.searchParams.get('passport'), new URL(lienConnexionMoodle('https://moodle.exemple.fr/campus')).searchParams.get('passport'));
  assert.deepEqual([...url.searchParams.keys()].sort(), ['confirmed', 'passport', 'service', 'urlscheme']);
  assert.throws(() => lienConnexionMoodle('http://moodle.exemple.fr'));
});

test('Moodle : le retour mobile fournit uniquement le jeton public et refuse les liens étrangers ou abîmés', () => {
  const id = 'a'.repeat(32), jeton = 'b'.repeat(32), prive = 'c'.repeat(32);
  for (const scheme of ['cordee-moodle', 'moodlemobile']) {
    for (const contenu of [`${id}:::${jeton}`, `${id}:::${jeton}:::${prive}`]) {
      const lien = `${scheme}://token=${Buffer.from(contenu).toString('base64')}`;
      assert.equal(jetonDepuisLienMoodle(lien), jeton);
      assert.equal(jetonDepuisLienMoodle(lien.replace(/=+$/, (s) => encodeURIComponent(s))), jeton);
    }
  }
  assert.equal(jetonDepuisLienMoodle('  jeton-manuel-factice  '), 'jeton-manuel-factice');
  for (const lien of ['https://exemple.fr/?token=secret', 'cordee-moodle://token=???', 'cordee-moodle://token=' + Buffer.from('secret').toString('base64'), 'cordee-moodle://token=' + 'a'.repeat(4097)]) {
    assert.throws(() => jetonDepuisLienMoodle(lien), (e) => !e.message.includes('secret'));
  }
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

test('Moodle : HTML converti en paragraphes et listes, scripts et liens actifs éliminés', () => {
  const texte = markdownMoodle('<p>Bonjour &eacute;tudiants&nbsp;!</p><ul><li>TD &amp; TP</li><li><a href="https://exemple.fr?token=factice">Sujet</a></li></ul><script>alert(1)</script><img src=x onerror=alert(2)><iframe src="https://exemple.fr">interdit</iframe>');
  assert.match(texte, /Bonjour étudiants \\!/);
  assert.match(texte, /- TD & TP/);
  assert.match(texte, /- Sujet/);
  assert.doesNotMatch(texte, /<|>|script|alert|interdit|token=factice|https:/);
  assert.doesNotMatch(markdownMoodle('&lt;script&gt;alert(3)&lt;/script&gt;<p>Texte</p>'), /script|alert|<|>/);
  assert.doesNotMatch(markdownMoodle('&amp;lt;script&amp;gt;alert(4)&amp;lt;/script&amp;gt;'), /script|alert|<|>/);
  assert.equal(markdownMoodle('<p>![image](https://exemple.fr)</p>').startsWith('\\!\\['), true);
});

test('Moodle : devoirs individuels, brouillons, rendus en groupe et prolongations', () => {
  const devoir = { id: 1, cmid: 45, name: '<b>TP énergie</b>', duedate: 1900000000 };
  const c = { shortname: 'ENER3' };
  const entree = devoirMoodle(devoir, c, { lastattempt: { submission: { status: 'submitted' } } }, 'https://moodle.exemple.fr');
  assert.deepEqual(entree, { titre: 'TP énergie', cours: 'ENER3', debut: 1900000000000, rendu: true, url: 'https://moodle.exemple.fr/mod/assign/view.php?id=45' });
  assert.equal(devoirMoodle(devoir, c, { lastattempt: { submission: { status: 'draft' } } }, 'https://moodle.exemple.fr').rendu, false);
  const groupe = devoirMoodle(devoir, c, { lastattempt: { teamsubmission: { status: 'submitted' }, extensionduedate: 1900010000 } }, 'https://moodle.exemple.fr');
  assert.equal(groupe.rendu, true);
  assert.equal(groupe.debut, 1900010000000);
  assert.equal(devoirMoodle({ ...devoir, duedate: 0 }, c, {}, 'https://moodle.exemple.fr'), null);
});

test('Moodle : les vingt dernières annonces sont datées, attribuées, triées et sans HTML', () => {
  const discussions = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, subject: `Annonce ${i}`, created: 1900000000 + i, userfullname: 'Équipe test', message: `<p>Texte ${i}</p><script>intrusion()</script>` }));
  const note = noteAnnoncesMoodle({ shortname: 'ENER3' }, discussions);
  assert.equal((note.match(/^## /gm) || []).length, 20);
  assert.ok(note.indexOf('Annonce 24') < note.indexOf('Annonce 23'));
  assert.match(note, /Annonce 5\n/);
  assert.doesNotMatch(note, /Annonce 4\n|<|>|script|intrusion/);
  assert.match(note, /Équipe test/);
});
