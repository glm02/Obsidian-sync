// Exemples synthétiques : aucun logiciel ni fichier personnel nécessaire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { lireAsc, lireKicad, calculerExpressionGeii: expression, calculerBlocGeii, notationIngenieurGeii: notation, estTexte } = require('../main.js').interne;
const exemple = nom => readFileSync(new URL('./exemples/' + nom, import.meta.url), 'utf8');
const proche = (a, b) => assert.ok(Math.abs(a - b) < 1e-10 * Math.max(1e-12, Math.abs(b)), `${a} ≠ ${b}`);

test('GEII : LTspice lit les fils, masses, nœuds, attributs et textes du RC', () => {
  const s = lireAsc(exemple('rc.asc'));
  assert.deepEqual(s.fils[0], [96, 80, 16, 80]); assert.equal(s.fils.length, 4);
  assert.deepEqual(s.noeuds.map(n => n.nom), ['entree', 'sortie', '0']);
  assert.deepEqual(s.symboles.map(c => [c.nom, c.valeur]), [['R1', '4.7k'], ['C1', '10u']]);
  assert.equal(s.symboles[0].orientation, 'R90');
  assert.equal(s.textes[1].texte, '.ac dec 20 1 100k');
  assert.equal(lireAsc('WIRE 1 2 NaN 4\nWIRE 1 2 3 99999999999\nSYMATTR Value seul').fils.length, 0);
  assert.equal(lireAsc('TEXT -10 0 Left 2 ;Une\\nDeux').textes[0].texte, 'Une\nDeux');
});

test('GEII : KiCad extrait seulement les composants placés et les feuilles', () => {
  const s = lireKicad(exemple('rc.kicad_sch'));
  assert.deepEqual(s.composants, [
    { reference: 'R1', valeur: '4.7k', empreinte: 'Resistor_SMD:R_0805_2012Metric' },
    { reference: 'C1', valeur: '10uF', empreinte: '' },
  ]);
  assert.deepEqual(s.feuilles, [{ nom: 'Alimentation (5 V)', fichier: 'alimentation.kicad_sch' }]);
  const echappe = lireKicad(String.raw`(kicad_sch (symbol (property "Reference" "U1") (property "Value" "Texte \"cité\" (ici)")))`);
  assert.equal(echappe.composants[0].valeur, 'Texte "cité" (ici)');
  for (const source of ['', '(kicad_sch', '(kicad_sch "sans fin)', '(autre)', '(kicad_sch))', '(kicad_sch) (x)']) assert.throws(() => lireKicad(source));
  assert.throws(() => lireKicad('(kicad_sch ' + '('.repeat(102) + ')'.repeat(103)), /complexe/);
});

test('GEII : calcul des priorités, signes, parenthèses et puissances à droite', () => {
  for (const [source, attendu] of [['2+3*4', 14], ['(2+3)*4', 20], ['2^3^2', 512], ['-2^2', -4], ['(-2)^2', 4], ['2^-3', 0.125], ['10/2*3-1', 14], ['1,5+2.5e-1', 1.75]]) proche(expression(source).valeur, attendu);
});

test('GEII : constantes et fonctions mathématiques autorisées', () => {
  for (const [source, attendu] of [['sqrt(9)', 3], ['log10(1000)', 3], ['ln(exp(2))', 2], ['2*pi', 2 * Math.PI], ['sqrt((3V)^2)', 3]]) proche(expression(source).valeur, attendu);
});

test('GEII : préfixes, unités et calcul RC avec réutilisation des variables', () => {
  for (const [prefixe, facteur] of [['p', 1e-12], ['n', 1e-9], ['µ', 1e-6], ['μ', 1e-6], ['u', 1e-6], ['m', 1e-3], ['k', 1e3], ['M', 1e6], ['G', 1e9]]) proche(expression('2' + prefixe).valeur, 2 * facteur);
  const r = calculerBlocGeii('R = 4.7kΩ\nC = 10 uF\ntau = R*C\nfc = 1/(2*pi*tau)\nfrequence = 1/(2*pi*470ohm*1µF)');
  assert.deepEqual(r.slice(0, 3).map(l => l.resultat), ['4,7 kΩ', '10 µF', '47 ms']);
  proche(r[3].valeur, 1 / (2 * Math.PI * 0.047)); assert.match(r[3].resultat, /Hz$/);
  assert.equal(r[4].resultat, '338,6 Hz');
  assert.equal(notation(expression('1V/1A')), '1 Ω');
  assert.equal(notation(expression('1V*1A')), '1 W');
  assert.equal(notation(expression('1mF + 1uF')), '1,001 mF');
});

test('GEII : notation ingénieur, arrondis, zéro, signes et exposants extrêmes', () => {
  for (const [valeur, texte] of [[0, '0'], [-0.0000047, '-4,7 µ'], [999999.99, '1 M'], [1e-15, '1,000e-15'], [1e15, '1,000e+15']]) assert.equal(notation(valeur), texte);
  assert.equal(notation(expression('1kΩ^2')), '1 ×10^6 Ω^2');
});

test('GEII : erreurs par ligne, unités incompatibles et poursuite après erreur', () => {
  const r = calculerBlocGeii('\nR = 1kΩ\nC = 10uF\ninvalide = R+C\ntau = R*C\nb = variable_absente\nz = 1/0\nR = ?\na = R\nvalide = 3');
  assert.equal(r[2].ligne, 4); assert.match(r[2].erreur, /Unités incompatibles/);
  assert.equal(r[3].resultat, '10 ms'); assert.match(r[4].erreur, /Variable inconnue/);
  assert.match(r[5].erreur, /non fini/); assert.match(r[7].erreur, /Variable inconnue/);
  assert.equal(r[8].resultat, '3');
  for (const source of ['ln(1V)', 'log10(0)', 'sqrt(-1)', '1^(1V)', 'exp(10000)', '(2+3', '2+', '']) assert.throws(() => expression(source));
  assert.match(calculerBlocGeii('pi=3')[0].erreur, /réservé/);
  assert.match(calculerBlocGeii('pas une affectation')[0].erreur, /nom = expression/);
});

test('GEII : le calcul refuse les instructions, accès objet, appels et injections', () => {
  for (const source of ['globalThis', 'process.exit()', 'Math.sqrt(4)', 'constructor.constructor("return 1")()', '(()=>1)()', '1;2', '1=2', '[1]', '{x:1}', '`x`', '"x"', '1//commentaire', '1/* commentaire */', '1&&2', '1<2', '2**3', 'sqrt(1,2,3)']) assert.throws(() => expression(source), source);
  assert.throws(() => expression('('.repeat(100) + '1' + ')'.repeat(100)), /imbriquée/);
  assert.throws(() => expression('1'.repeat(2001)), /longue/);
  const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8').split('/* ---------- Logiciels GEII ---------- */')[1];
  assert.doesNotMatch(source, /\beval\s*\(|\bFunction\s*\(/);
});

test('GEII : les extensions logicielles gardent la stratégie de copie de conflit', () => {
  for (const extension of ['asc', 'kicad_sch', 'kicad_pcb', 'kicad_pro', 'ino', 'c', 'h', 'm', 'py', 'vhd', 'asm', 's']) assert.equal(estTexte('montage.' + extension), false);
  for (const extension of ['md', 'txt', 'csv']) assert.equal(estTexte('note.' + extension), true);
});
