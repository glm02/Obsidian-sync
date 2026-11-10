import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function charger(etat, navigateur = {}) {
  const rendu = { textes: [], boutons: new Map(), elements: [], ouvertures: 0 };
  const container = (racine = true) => ({
    enfants: [],
    empty() {
      const descendants = new Set();
      const ajouter = (node) => { descendants.add(node); node.enfants.forEach(ajouter); };
      this.enfants.forEach(ajouter); this.enfants = [];
      rendu.elements = rendu.elements.filter((element) => !descendants.has(element));
      if (racine) { rendu.textes = []; rendu.boutons.clear(); }
    },
    setText(text) { this.textContent = text; rendu.textes.push(text); },
    replaceWith() { rendu.elements = rendu.elements.filter((element) => element !== this); },
    createEl(tag, attrs = {}) { const enfant = container(false); enfant.tag = tag; enfant.attrs = attrs; enfant.textContent = attrs.text || ''; if (attrs.text) rendu.textes.push(attrs.text); this.enfants.push(enfant); rendu.elements.push(enfant); return enfant; },
  });
  const champ = { inputEl: {}, setValue() { return this; }, setPlaceholder() { return this; }, onChange() { return this; } };
  const obsidian = {
    Plugin: class {
      constructor() { this.app = { workspace: { onLayoutReady() {} }, vault: { configDir: 'configuration', getFiles: () => [] } }; }
      async loadData() { return etat; }
      async saveData(data) { rendu.sauvegarde = JSON.parse(JSON.stringify(data)); }
      addStatusBarItem() { return { setText() {} }; }
      addSettingTab(tab) { this.onglet = tab; }
      addRibbonIcon(id, label, callback) { this.ruban = { id, label, callback }; }
      addCommand() {}
      registerObsidianProtocolHandler(action, callback) { this.protocole = { action, callback }; }
      registerInterval(callback) { this.intervalle = callback; }
    },
    PluginSettingTab: class { constructor(app) { this.app = app; this.containerEl = container(); } },
    Modal: class { constructor(app) { this.app = app; this.contentEl = container(); } open() { rendu.ouvertures++; rendu.modal = this; return this.onOpen(); } },
    Setting: class {
      setName() { return this; }
      setDesc() { return this; }
      addText(callback) { callback(champ); return this; }
      addButton(callback) {
        let label, action;
        const bouton = { setButtonText(text) { if (label) rendu.boutons.delete(label); label = text; if (action) rendu.boutons.set(label, () => !this.disabled && action()); return this; }, setDisabled(disabled) { this.disabled = disabled; return this; }, setCta() { return this; }, setWarning() { return this; }, onClick(callback) { action = callback; if (label) rendu.boutons.set(label, () => !this.disabled && action()); return this; } };
        callback(bouton);
        return this;
      }
    },
    addIcon(id, svg) { rendu.icone = { id, svg }; },
    Notice: class { constructor(text) { rendu.notice = text; } },
  };
  const context = { require: () => obsidian, module: { exports: {} }, TextEncoder, TextDecoder, clearTimeout, URL, URLSearchParams, atob, window: { setInterval: callback => callback }, ...navigateur };
  vm.runInNewContext(readFileSync(new URL('../main.js', import.meta.url), 'utf8'), context);
  return { plugin: new context.module.exports(), rendu, interne: context.module.exports.interne };
}

test('le logo ouvre le partage connecté et conserve le formulaire après déconnexion', async () => {
  const { plugin, rendu } = charger({ serveur: 'https://cordee.example', coffreId: 'test', jeton: 'test-token', nomCoffre: 'Notre coffre' });
  let invitations = 0;
  plugin.inviter = () => { invitations++; };
  plugin.quitter = async () => { plugin.etat.coffreId = ''; plugin.etat.jeton = ''; };
  await plugin.onload();
  assert.equal(plugin.ruban.id, rendu.icone.id);
  assert.match(rendu.icone.svg, /fill="currentColor"/);
  plugin.ruban.callback();
  assert.equal(rendu.ouvertures, 1);
  assert.ok(rendu.textes.includes('Coffre partagé : Notre coffre'));
  await rendu.boutons.get('Créer une invitation')();
  assert.equal(invitations, 1);
  await rendu.boutons.get('Quitter')();
  assert.ok(rendu.textes.includes('Rejoindre un coffre'));
  assert.ok(rendu.boutons.has('Rejoindre'));
  plugin.onglet.display();
  assert.ok(rendu.boutons.has('Créer et partager'));
});

test('une invitation ouvre le formulaire sans rejoindre ni remplacer un coffre existant', async () => {
  const { plugin, rendu } = charger({});
  await plugin.onload();
  plugin.rejoindreOuCreer = () => assert.fail('Un lien ne doit pas rejoindre automatiquement');
  plugin.protocole.callback({ serveur: 'https://cordee.example', code: 'ABCD-EFGH-JKLM' });
  assert.equal(rendu.ouvertures, 1);
  assert.ok(rendu.boutons.has('Rejoindre'));
  plugin.protocole.callback({ serveur: 'javascript:alert(1)', code: 'ABCD' });
  assert.equal(rendu.ouvertures, 1);
  Object.assign(plugin.etat, { serveur: 'https://cordee.example', coffreId: 'existant', jeton: 'test-token' });
  plugin.protocole.callback({ serveur: 'https://autre.example', code: 'ABCD' });
  assert.equal(plugin.etat.coffreId, 'existant');
});

test('les changements distants sont vérifiés sans flux fetch, puis arrêtés au déchargement', async () => {
  const { plugin } = charger({ serveur: 'https://cordee.example', coffreId: 'test', jeton: 'test-token', derniereRev: 3 });
  await plugin.onload();
  let synchros = 0;
  plugin.moteur.api = async () => ({ json: async () => ({ rev: 4 }) });
  plugin.lancer = async () => { synchros++; };
  plugin.ecouter();
  await plugin.intervalle();
  assert.equal(synchros, 1);
  plugin.onunload();
  await plugin.intervalle();
  assert.equal(synchros, 1);
});

test('la pause coupe les automatismes, autorise une synchro ponctuelle et persiste après reprise', async () => {
  const { plugin, rendu } = charger({ serveur: 'https://cordee.example', coffreId: 'test', jeton: 'test-token' });
  await plugin.onload();
  let synchronisations = 0;
  plugin.moteur.synchroniser = async () => { synchronisations++; plugin.moteur.signaler('synchro'); plugin.moteur.signaler('ok'); };
  plugin.moteur.api = () => assert.fail('Aucun sondage réseau pendant la pause');
  plugin.ecouter();
  await plugin.mettreEnPause(true);
  assert.equal(rendu.sauvegarde.enPause, true);
  await plugin.lancer();
  await plugin.intervalle();
  assert.equal(synchronisations, 0);
  await plugin.lancer({ forcer: true });
  assert.equal(synchronisations, 1);
  assert.equal(plugin.etat.enPause, true);
  assert.equal(typeof rendu.sauvegarde.derniereSynchro, 'number');
  await plugin.mettreEnPause(false);
  assert.equal(synchronisations, 2);
  assert.equal(rendu.sauvegarde.enPause, false);
});

test('un échec de sauvegarde du réglage ne prétend pas avoir mis la synchro en pause', async () => {
  const { plugin, rendu } = charger({ serveur: 'https://cordee.example', coffreId: 'test', jeton: 'test-token' });
  await plugin.onload();
  plugin.saveData = async () => { throw Error('disque indisponible'); };
  await plugin.mettreEnPause(true);
  assert.equal(plugin.etat.enPause, false);
  assert.match(rendu.notice, /Impossible de conserver/);
});

test('le panneau met à jour son état sans accumuler des abonnements', async () => {
  const { plugin, rendu } = charger({ serveur: 'https://cordee.example', coffreId: 'test', jeton: 'test-token', nomCoffre: 'Notre coffre' });
  await plugin.onload();
  plugin.ruban.callback();
  assert.equal(plugin.abonnesStatut.size, 1);
  plugin.signalerErreur({ statut: 403 }, 'synchro');
  assert.ok(rendu.textes.some(text => text.includes('Accès refusé')));
  rendu.modal.onOpen();
  assert.equal(plugin.abonnesStatut.size, 1);
  rendu.modal.onClose();
  assert.equal(plugin.abonnesStatut.size, 0);
});

test('les membres et les changements se consultent depuis le panneau', async () => {
  const { plugin, rendu } = charger({ serveur: 'https://cordee.example', coffreId: 'test', jeton: 'test-token', nomCoffre: 'Notre coffre' });
  await plugin.onload();
  plugin.moteur.api = async (methode, route) => ({ json: async () => route.endsWith('/test') ? { rev: 1, membres: [{ nom: 'Membre test', arrive_le: 1700000000000 }] } : { changements: [{ chemin: 'note.md', auteur: 'Membre test', le: 1700000000000, supprime: false }] } });
  plugin.ruban.callback();
  await rendu.boutons.get('Voir l’activité')();
  assert.ok(rendu.textes.includes('1 membre'));
  assert.ok(rendu.textes.some(text => text.includes('Membre test')));
  assert.ok(rendu.textes.some(text => text.includes('a modifié note.md')));
  assert.ok(rendu.boutons.has('Actualiser'));
});

test('un dossier de configuration personnalisé est exclu des envois et des écritures distantes', async () => {
  const { plugin } = charger({});
  plugin.app.vault.getFiles = () => [
    { path: 'configuration/plugins/cordee/data.json', stat: { mtime: 1, size: 100 } },
    { path: 'configuration-bis/note.md', stat: { mtime: 1, size: 10 } },
  ];
  await plugin.onload();
  assert.equal(plugin.moteur.ignorer('configuration/app.json'), true);
  assert.equal(plugin.moteur.ignorer('CONFIGURATION/app.json'), true);
  assert.equal(plugin.moteur.ignorer('configuration-bis/note.md'), false);
  assert.deepEqual(plugin.moteur.fichiers.lister().map(f => f.chemin), ['configuration-bis/note.md']);
  assert.equal(await plugin.moteur.fichiers.lire('configuration/plugins/cordee/data.json'), null);
  await assert.rejects(plugin.moteur.fichiers.ecrire('configuration/app.json', new ArrayBuffer(0)), /configuration/);
  await assert.rejects(plugin.moteur.fichiers.supprimer('configuration/app.json'), /configuration/);
  await assert.rejects(plugin.moteur.fichiers.renommer('note.md', 'configuration/app.json'), /configuration/);
  await assert.rejects(plugin.moteur.fichiers.ecrire('CONFIGURATION/app.json', new ArrayBuffer(0)), /configuration/);
  await assert.rejects(plugin.moteur.fichiers.supprimer('CONFIGURATION/app.json'), /configuration/);
  await assert.rejects(plugin.moteur.fichiers.renommer('CONFIGURATION/app.json', 'note.md'), /configuration/);
  await assert.rejects(plugin.moteur.fichiers.renommer('note.md', 'CONFIGURATION/app.json'), /configuration/);
});

const JPEG_TEST = 'data:image/jpeg;base64,/9j/2Q==';
const PNG_TEST = 'data:image/png;base64,iVBORw0KGgo=';
const ETAT_TEST = { serveur: 'https://cordee.example', coffreId: 'test', jeton: 'test-token', prenom: 'Membre test' };
const INFO_TEST = { rev: 1, moiId: 'm1', membres: [{ id: 'm1', nom: 'Membre test', arrive_le: 1700000000000, avatar: JPEG_TEST }] };

function navigateurPhoto() {
  const appels = { revoque: 0, dessin: null };
  const contexte = { fillRect() {}, drawImage(...args) { appels.dessin = args; } };
  const canvas = { getContext: () => contexte, toDataURL: () => JPEG_TEST };
  class ImageTest { naturalWidth = 256; naturalHeight = 128; set src(value) { this.onload(); } }
  class URLTest extends URL { static createObjectURL() { return 'blob:test'; } static revokeObjectURL() { appels.revoque++; } }
  return { appels, canvas, navigateur: { Image: ImageTest, URL: URLTest, document: { createElement: () => canvas } } };
}

function fichierPhoto(type = 'image/jpeg', size = 4, octets = [255, 216, 255, 217]) {
  return { type, size, slice: () => ({ arrayBuffer: async () => new Uint8Array(octets).buffer }) };
}

test('la préparation recadre en 128 px et refuse SVG, fichiers falsifiés et fichiers trop gros', async () => {
  const { interne } = charger({});
  const { navigateur, appels, canvas } = navigateurPhoto();
  assert.equal(await interne.preparerPhoto(fichierPhoto(), navigateur), JPEG_TEST);
  assert.equal(canvas.width, 128); assert.equal(canvas.height, 128);
  assert.deepEqual(Array.from(appels.dessin.slice(1)), [64, 0, 128, 128, 0, 0, 128, 128]);
  assert.equal(appels.revoque, 1);
  await assert.rejects(interne.preparerPhoto(fichierPhoto('image/svg+xml'), navigateur), /JPEG, PNG ou WebP/);
  await assert.rejects(interne.preparerPhoto(fichierPhoto('image/jpeg', 11 * 1024 * 1024), navigateur), /10 Mo/);
  await assert.rejects(interne.preparerPhoto(fichierPhoto('image/jpeg', 4, [60, 115, 118, 103]), navigateur), /format/);
  assert.equal(appels.revoque, 1);
  assert.equal(interne.avatarValide('https://example.org/photo.jpg'), null);
  assert.equal(interne.avatarValide('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.equal(interne.avatarValide('data:image/jpeg;base64,PHN2Zz4='), null);
  assert.equal(interne.avatarValide('data:image/jpeg;base64,' + '/9j/' + 'AAAA'.repeat(12000)), null);
});

test('la photo choisie reste locale jusqu’à Enregistrer et peut ensuite être retirée', async () => {
  const { navigateur } = navigateurPhoto();
  const { plugin, rendu } = charger(ETAT_TEST, navigateur);
  await plugin.onload();
  const ecritures = [];
  plugin.moteur.api = async (methode, route, corps) => {
    if (methode === 'PUT') { ecritures.push({ route, avatar: corps.avatar }); return { json: async () => ({ id: 'm1', nom: 'Membre test', avatar: corps.avatar }) }; }
    return { json: async () => INFO_TEST };
  };
  plugin.ruban.callback();
  await rendu.boutons.get('Mon profil')();
  const entree = rendu.elements.find((element) => element.tag === 'input' && element.attrs.type === 'file');
  entree.files = [fichierPhoto()];
  await entree.onchange();
  assert.equal(ecritures.length, 0);
  assert.ok(rendu.textes.some((texte) => texte.includes('Aperçu prêt')));
  await rendu.boutons.get('Enregistrer la photo')();
  assert.deepEqual(ecritures, [{ route: '/api/coffres/test/profil', avatar: JPEG_TEST }]);
  await rendu.boutons.get('Retirer la photo')();
  assert.equal(ecritures.length, 2); assert.equal(ecritures[1].avatar, null);
  assert.ok(rendu.textes.some((texte) => texte.includes('Photo retirée')));
});

test('l’activité associe la photo à l’identifiant de l’auteur malgré les homonymes', async () => {
  const { plugin, rendu } = charger(ETAT_TEST);
  await plugin.onload();
  plugin.moteur.api = async (methode, route) => ({ json: async () => route.endsWith('/test') ? {
    rev: 3, membres: [
      { id: 'm1', nom: 'Même nom', avatar: JPEG_TEST, arrive_le: 1700000000000 },
      { id: 'm2', nom: 'Même nom', avatar: PNG_TEST, arrive_le: 1700000000000 },
      { id: 'm3', nom: 'URL refusée', avatar: 'https://example.org/photo.jpg', arrive_le: 1700000000000 },
    ]
  } : { changements: [
    { auteurId: 'm2', auteur: 'Même nom', chemin: 'note.md', le: 1700000000000, supprime: false },
    { auteurId: 'ancien', auteur: 'Ancien membre', chemin: 'image.png', le: 1700000000000, supprime: true },
  ] } });
  plugin.ruban.callback(); await rendu.boutons.get('Voir l’activité')();
  const images = rendu.elements.filter((element) => element.tag === 'img');
  assert.deepEqual(images.map((image) => image.attrs.attr.src), [JPEG_TEST, PNG_TEST, PNG_TEST]);
  assert.ok(images.every((image) => image.attrs.attr.alt === 'Photo de Même nom'));
  assert.ok(rendu.textes.some((texte) => texte.includes('Même nom · a modifié note.md')));
  assert.ok(rendu.textes.some((texte) => texte.includes('Ancien membre · a supprimé image.png')));
  assert.ok(rendu.elements.some((element) => element.attrs.attr?.['aria-label'] === 'Profil de Ancien membre'));
  images[0].onerror();
  assert.equal(rendu.elements.filter((element) => element.tag === 'img').length, 2);
  assert.ok(rendu.elements.some((element) => element.attrs.attr?.['aria-label'] === 'Profil de Même nom'));
});

test('un ancien serveur conserve l’activité et indique que le profil demande une mise à jour', async () => {
  const { plugin, rendu } = charger(ETAT_TEST); await plugin.onload();
  let ecritures = 0;
  plugin.moteur.api = async (methode) => { if (methode !== 'GET') ecritures++; return { json: async () => ({ membres: [{ nom: 'Membre test' }] }) }; };
  plugin.ruban.callback(); await rendu.boutons.get('Mon profil')();
  assert.ok(rendu.textes.some((texte) => texte.includes('mise à jour du serveur')));
  assert.equal(rendu.boutons.has('Enregistrer la photo'), false);
  assert.equal(ecritures, 0);
});

test('fermer le profil ou quitter le coffre ignore un chargement en attente', async () => {
  for (const fermer of [true, false]) {
    const { plugin, rendu } = charger(ETAT_TEST); await plugin.onload();
    let terminer;
    plugin.moteur.api = () => new Promise((resolve) => { terminer = resolve; });
    plugin.ruban.callback();
    const chargement = rendu.boutons.get('Mon profil')();
    if (fermer) rendu.modal.onClose(); else plugin.etat.coffreId = 'autre';
    terminer({ json: async () => INFO_TEST }); await chargement;
    assert.equal(rendu.boutons.has('Enregistrer la photo'), false);
  }
});

test('la pause commandée hors du panneau actualise son bouton sans effacer les champs', async () => {
  const { plugin, rendu } = charger(ETAT_TEST); await plugin.onload();
  plugin.moteur.synchroniser = async () => {};
  plugin.ruban.callback();
  assert.equal(rendu.boutons.has('Mettre en pause'), true);
  await plugin.mettreEnPause(true);
  assert.equal(rendu.boutons.has('Mettre en pause'), false);
  assert.equal(rendu.boutons.has('Reprendre'), true);
  await rendu.boutons.get('Reprendre')();
  assert.equal(plugin.etat.enPause, false);
  assert.equal(rendu.boutons.has('Mettre en pause'), true);
});
