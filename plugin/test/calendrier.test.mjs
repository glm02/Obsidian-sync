// Tests du calendrier : lecture iCal (ADE, Moodle, agendas classiques), répétitions, agenda de la cordée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { lireCalendriersPartages, modifierCalendriersPartages, lireIcs, developper, lireAgendaPartage, ligneAgenda, typeCalendrier, masquerUrl, debutSemaine, placerEnColonnes } = require('../main.js').interne;

const ics = (...evenements) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//FR', ...evenements.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const local = (a, mo, j, h = 0, mi = 0) => new Date(a, mo - 1, j, h, mi).getTime();

test('emploi du temps façon ADE : heures UTC, lieu, description sur plusieurs lignes', () => {
  const [e] = lireIcs(ics([
    'DTSTAMP:20261110T120000Z', 'DTSTART:20261112T070000Z', 'DTEND:20261112T090000Z',
    'SUMMARY:TD ENER3', 'LOCATION:Salle 104', 'DESCRIPTION:\\nGroupe 2\\nM. Dupont\\n(Exporté le:10/11/2026)', 'UID:ADE60001',
  ]));
  assert.equal(e.titre, 'TD ENER3');
  assert.equal(e.lieu, 'Salle 104');
  assert.equal(e.debut, Date.UTC(2026, 10, 12, 7, 0));
  assert.equal(e.fin, Date.UTC(2026, 10, 12, 9, 0));
  assert.match(e.description, /^Groupe 2\nM\. Dupont/);
});

test('lignes repliées, caractères échappés, journée entière', () => {
  const evts = lireIcs(ics(
    ['DTSTART;VALUE=DATE:20261113', 'SUMMARY:Journée portes\r\n  ouvertes\\, IUT\\; amphi'],
    ['DTSTART:20261113T080000', 'SUMMARY:Sans fin indiquée'],
  ));
  assert.equal(evts[0].titre, 'Journée portes ouvertes, IUT; amphi');
  assert.equal(evts[0].journee, true);
  assert.equal(evts[0].fin - evts[0].debut, 24 * 3600_000);
  assert.equal(evts[1].debut, local(2026, 11, 13, 8));
  assert.equal(evts[1].fin, evts[1].debut, 'sans DTEND, un événement daté est ponctuel');
});

test('Moodle : devoir à rendre (instant précis), reconnu à son lien, et visible dans la semaine', () => {
  const url = 'https://moodle.exemple.fr/calendar/export_execute.php?userid=42&authtoken=CLESECRETE&preset_what=all&preset_time=recentupcoming';
  assert.equal(typeCalendrier(url), 'moodle');
  assert.equal(typeCalendrier('https://ade.exemple.fr/jsp/custom/modules/plannings/anonymous_cal.jsp?resources=123'), 'edt');
  assert.equal(typeCalendrier('https://calendar.exemple.com/basic.ics'), 'autre');
  const evts = lireIcs(ics(['DTSTART:20261114T225900Z', 'DTEND:20261114T225900Z', 'SUMMARY:Rendu TP2 ENER3 est dû']));
  const semaine = developper(evts, local(2026, 11, 9), local(2026, 11, 16));
  assert.equal(semaine.length, 1);
  assert.equal(semaine[0].titre, 'Rendu TP2 ENER3 est dû');
});

test('le lien d’un calendrier n’est jamais montré en entier : la clé reste cachée', () => {
  const masque = masquerUrl('https://moodle.exemple.fr/calendar/export_execute.php?userid=42&authtoken=CLESECRETE');
  assert.equal(masque, 'moodle.exemple.fr/…');
  assert.doesNotMatch(masque, /CLESECRETE|userid/);
  assert.equal(masquerUrl('webcal://agenda.exemple.fr/a.ics'), 'agenda.exemple.fr/…');
  assert.equal(masquerUrl('pas un lien'), 'lien invalide');
});

test('répétition hebdomadaire : jours choisis, nombre limité, exception retirée', () => {
  const evts = lireIcs(ics([
    'DTSTART;TZID=Europe/Paris:20261102T100000', 'DTEND;TZID=Europe/Paris:20261102T110000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4', 'EXDATE;TZID=Europe/Paris:20261104T100000', 'SUMMARY:Anglais',
  ]));
  const occ = developper(evts, local(2026, 11, 1), local(2026, 12, 1));
  assert.deepEqual(occ.map((e) => new Date(e.debut).getDate()), [2, 9, 11], 'le 4 est exclu, et COUNT compte aussi l’exception');
  assert.ok(occ.every((e) => new Date(e.debut).getHours() === 10 && e.fin - e.debut === 3600_000));
});

test('répétition quotidienne avec intervalle et date de fin', () => {
  const evts = lireIcs(ics(['DTSTART:20261101T090000', 'DTEND:20261101T093000', 'RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261107T000000Z', 'SUMMARY:Footing']));
  assert.deepEqual(developper(evts, local(2026, 11, 1), local(2026, 11, 30)).map((e) => new Date(e.debut).getDate()), [1, 3, 5]);
  // Une fenêtre au milieu de la série ne montre que ce qui la touche.
  assert.deepEqual(developper(evts, local(2026, 11, 2), local(2026, 11, 4)).map((e) => new Date(e.debut).getDate()), [3]);
});

test('agenda de la cordée : lignes lisibles, heures facultatives, lieu et auteur reconnus', () => {
  const texte = [
    '# Agenda de la cordée', '',
    '- 2026-11-12 14:00-16:00 Révision ENER3 @ BU (ajouté par Bruno)',
    '- [ ] 2026-11-13 9h30 Point projet SAE',
    '- 2026-11-15 Rendu du rapport de TP',
    '- pas une date du tout',
  ].join('\n');
  const evts = lireAgendaPartage(texte);
  assert.equal(evts.length, 3);
  assert.deepEqual([evts[0].titre, evts[0].lieu, evts[0].auteur], ['Révision ENER3', 'BU', 'Bruno']);
  assert.equal(evts[0].debut, local(2026, 11, 12, 14));
  assert.equal(evts[0].fin, local(2026, 11, 12, 16));
  assert.equal(evts[1].fin - evts[1].debut, 3600_000, 'sans heure de fin : une heure');
  assert.equal(evts[2].journee, true);
});

test('une ligne ajoutée se relit à l’identique, sans casser le format', () => {
  const ligne = ligneAgenda({ jour: '2026-11-12', debut: '14:00', fin: '16:00', titre: 'Révision\nENER3 @ chez moi', lieu: 'BU', auteur: 'raf' });
  assert.equal(ligne, '- 2026-11-12 14:00-16:00 Révision ENER3 – chez moi @ BU (ajouté par raf)');
  const [e] = lireAgendaPartage(ligne);
  assert.deepEqual([e.titre, e.lieu, e.auteur], ['Révision ENER3 – chez moi', 'BU', 'raf']);
  assert.equal(ligneAgenda({ jour: '2026-11-15', titre: 'Rendu' }), '- 2026-11-15 Rendu');
});

test('la semaine commence le lundi, même un dimanche soir', () => {
  assert.equal(debutSemaine(local(2026, 11, 15, 22)), local(2026, 11, 9));
  assert.equal(debutSemaine(local(2026, 11, 9, 0, 1)), local(2026, 11, 9));
});

test('des cours qui se chevauchent sont mis côte à côte', () => {
  const h = (x) => local(2026, 11, 12, x);
  const places = placerEnColonnes([{ debut: h(8), fin: h(10) }, { debut: h(9), fin: h(11) }, { debut: h(10), fin: h(12) }, { debut: h(14), fin: h(15) }]);
  const par = (debut) => places.find((p) => p.e.debut === debut);
  assert.equal(par(h(8)).colonnes, 2);
  assert.notEqual(par(h(8)).colonne, par(h(9)).colonne);
  assert.equal(par(h(10)).colonne, par(h(8)).colonne, 'la place libérée à 10 h est reprise');
  assert.equal(par(h(14)).colonnes, 1, 'un cours seul prend toute la largeur');
});

test('calendriers partagés : des liens dans la note commune, ajoutés sans toucher aux créneaux', () => {
  const avant = ['# Agenda de la cordée', '', 'Explication.', '', '- 2026-11-12 14:00-16:00 Révision @ BU (ajouté par Bruno)'].join('\n');
  const apres = modifierCalendriersPartages(avant, { ajouter: { nom: 'Emploi du temps S3', url: 'https://ade.exemple.fr/cal.ics' } });
  const [source] = lireCalendriersPartages(apres);
  assert.deepEqual([source.nom, source.url, source.type, source.partage], ['Emploi du temps S3', 'https://ade.exemple.fr/cal.ics', 'edt', true]);
  assert.ok(apres.indexOf('## Calendriers partagés') < apres.indexOf('- 2026-11-12'), 'la section passe avant les créneaux');
  assert.ok(apres.includes('- 2026-11-12 14:00-16:00 Révision @ BU (ajouté par Bruno)'), 'le créneau est intact');
  // Un second ajout va dans la même section ; le retrait n'enlève que ce lien.
  const deux = modifierCalendriersPartages(apres, { ajouter: { nom: 'Club robotique', url: 'webcal://agenda.exemple.fr/robot.ics' } });
  assert.equal(deux.split('## Calendriers partagés').length, 2);
  assert.equal(lireCalendriersPartages(deux).length, 2);
  const retire = modifierCalendriersPartages(deux, { retirerUrl: 'https://ade.exemple.fr/cal.ics' });
  assert.deepEqual(lireCalendriersPartages(retire).map((x) => x.nom), ['Club robotique']);
  assert.ok(retire.includes('- 2026-11-12 14:00-16:00'));
  // Même lien deux fois : compté une fois ; identifiant stable.
  assert.equal(lireCalendriersPartages(deux + '\n- [Doublon](webcal://agenda.exemple.fr/robot.ics)').length, 2);
  assert.equal(lireCalendriersPartages(deux)[0].id, lireCalendriersPartages(deux)[0].id);
});
