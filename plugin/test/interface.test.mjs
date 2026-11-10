import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function charger(etat, navigateur = {}) {
  const rendu = { textes: [], boutons: new Map(), elements: [], champs: [], ouvertures: 0 };
  const container = (racine = true) => ({
    enfants: [],
    empty() {
      const descendants = new Set();
      const ajouter = (node) => { descendants.add(node); node.enfants.forEach(ajouter); };
      this.enfants.forEach(ajouter); this.enfants = [];
      for (const enfant of descendants) if (rendu.boutons.get(enfant.labelBouton) === enfant.actionBouton) rendu.boutons.delete(enfant.labelBouton);
      rendu.elements = rendu.elements.filter((element) => !descendants.has(element));
      if (racine) { rendu.textes = []; rendu.boutons.clear(); rendu.champs = []; }
    },
    enregistrerBouton() {
      if (this.tag !== 'button' || !this.action) return;
      if (rendu.boutons.get(this.labelBouton) === this.actionBouton) rendu.boutons.delete(this.labelBouton);
      this.labelBouton = this.attrs.attr?.['aria-label'] || this.textContent;
      this.actionBouton = () => !this.disabled && this.action(); rendu.boutons.set(this.labelBouton, this.actionBouton);
    },
    setText(text) { this.textContent = text; rendu.textes.push(text); this.enregistrerBouton(); },
    setAttribute(nom, valeur) { this.attrs.attr ||= {}; this.attrs.attr[nom] = valeur; this.enregistrerBouton(); },
    replaceWith() { rendu.elements = rendu.elements.filter((element) => element !== this); },
    createEl(tag, attrs = {}) { const enfant = container(false); enfant.tag = tag; enfant.attrs = attrs; enfant.textContent = attrs.text || ''; if (attrs.text) rendu.textes.push(attrs.text); Object.defineProperty(enfant, 'onclick', { set(action) { this.action = action; this.enregistrerBouton(); } }); this.enfants.push(enfant); rendu.elements.push(enfant); return enfant; },
  });
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
      setName(nom) { this.nom = nom; return this; }
      setDesc() { return this; }
      addText(callback) {
        const champ = { inputEl: {}, setValue(v) { this.value = v; return this; }, setPlaceholder() { return this; }, onChange(action) { this.change = action; return this; } };
        callback(champ); rendu.champs.push({ nom: this.nom, champ }); return this;
      }
      addButton(callback) {
        let label, action;
        const bouton = { setButtonText(text) { if (label) rendu.boutons.delete(label); label = text; if (action) rendu.boutons.set(label, () => !this.disabled && action()); return this; }, setDisabled(disabled) { this.disabled = disabled; return this; }, setCta() { return this; }, setWarning() { return this; }, onClick(callback) { action = callback; if (label) rendu.boutons.set(label, () => !this.disabled && action()); return this; } };
        callback(bouton);
        return this;
      }
    },
    TFile: class {},
    TFolder: class {},
    addIcon(id, svg) { rendu.icone = { id, svg }; },
    Notice: class { constructor(text) { rendu.notice = text; } },
  };
  const context = { require: () => obsidian, module: { exports: {} }, TextEncoder, TextDecoder, clearTimeout, URL, URLSearchParams, atob, window: { setInterval: callback => callback }, ...navigateur };
  vm.runInNewContext(readFileSync(new URL('../main.js', import.meta.url), 'utf8'), context);
  return { plugin: new context.module.exports(), rendu, obsidian, interne: context.module.exports.interne };
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
  await rendu.boutons.get('Configurer')();
  await rendu.boutons.get('Quitter')();
  assert.ok(rendu.textes.includes('Rejoindre un coffre'));
  assert.ok(rendu.boutons.has('Rejoindre'));
  plugin.onglet.display();
  assert.ok(rendu.boutons.has('Créer un nouveau partage'));
  await rendu.boutons.get('Créer un nouveau partage')();
  assert.ok(rendu.boutons.has('Créer et partager'));
});

test('un nouveau coffre retrouve serveur et nom sans reprendre les accès du précédent', async () => {
  const valeurs = new Map();
  const localStorage = { getItem: (cle) => valeurs.get(cle) || null, setItem: (cle, valeur) => valeurs.set(cle, valeur) };
  const premier = charger({ serveur: 'https://cordee.example', coffreId: 'ancien', jeton: 'jeton-local-test', prenom: 'Membre test' }, { localStorage });
  await premier.plugin.onload();
  const preferences = JSON.parse(valeurs.get('cordee.preferences.v1'));
  assert.deepEqual(preferences, { serveur: 'https://cordee.example', prenom: 'Membre test' });
  const { plugin, rendu } = charger({}, { localStorage });
  await plugin.onload();
  assert.equal(plugin.connecte(), false);
  assert.equal(plugin.etat.jeton, '');
  plugin.ruban.callback();
  assert.equal(rendu.champs.find(c => c.nom === 'Nom affiché').champ.value, 'Membre test');
  assert.equal(rendu.champs.some(c => c.nom === 'Adresse du serveur'), false);
  assert.equal(rendu.boutons.has('Créer et partager'), false);
  let appel;
  plugin.rejoindreOuCreer = async (...args) => { appel = args; };
  rendu.champs.find(c => c.nom === 'Invitation ou code').champ.change('ABCD-EFGH-JKLM');
  assert.equal(appel, undefined);
  await rendu.boutons.get('Rejoindre')();
  assert.equal(appel[0], '/api/rejoindre');
  assert.equal(appel[1].prenom, 'Membre test');
  assert.equal(appel[2], 'https://cordee.example');
  rendu.champs.find(c => c.nom === 'Invitation ou code').champ.change('https://autre.example/rejoindre/ABCD-EFGH-JKLM');
  await rendu.boutons.get('Rejoindre')();
  assert.equal(appel[2], 'https://autre.example');
  assert.equal(JSON.parse(valeurs.get('cordee.preferences.v1')).serveur, 'https://cordee.example');
});

test('les préférences indisponibles ou invalides ne bloquent pas une invitation complète', async () => {
  for (const stockage of [null, '{', JSON.stringify({ serveur: 'javascript:alert(1)', prenom: 42 })]) {
    const { plugin, rendu } = charger({}, { localStorage: { getItem() { if (stockage === null) throw Error('stockage indisponible'); return stockage; }, setItem() { throw Error('stockage indisponible'); } } });
    await plugin.onload(); plugin.ruban.callback();
    assert.equal(rendu.modal.reglages.form.serveur, '');
    const formulaire = rendu.modal.reglages.form;
    formulaire.invitation = 'https://cordee.example/rejoindre/ABCD-EFGH-JKLM'; formulaire.prenom = 'Membre test';
    let destination;
    plugin.rejoindreOuCreer = async (route, corps, serveur) => { destination = serveur; };
    await rendu.boutons.get('Rejoindre')();
    assert.equal(destination, 'https://cordee.example');
    assert.doesNotThrow(() => plugin.memoriserPreferences());
  }
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

test('les membres et les changements se consultent directement dans le panneau', async () => {
  const { plugin, rendu } = charger({ serveur: 'https://cordee.example', coffreId: 'test', jeton: 'test-token', nomCoffre: 'Notre coffre' });
  await plugin.onload();
  plugin.moteur.api = async (methode, route) => ({ json: async () => route.endsWith('/test') ? { rev: 1, membres: [{ nom: 'Membre test', arrive_le: 1700000000000 }] } : { changements: [{ chemin: 'note.md', auteur: 'Membre test', le: 1700000000000, supprime: false }] } });
  await plugin.ruban.callback();
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

test('un dossier distant ne supprime ni fichier caché ni fichier arrivé pendant la vérification', async () => {
  const { plugin } = charger({});
  let suppressions = 0;
  plugin.app.vault.adapter = {
    list: async () => ({ files: ['Partage/.secret'], folders: [] }),
    rmdir: async () => { assert.fail('Le fichier caché doit empêcher toute suppression'); },
    exists: async () => true,
  };
  await plugin.onload();
  const fichiers = plugin.moteur.fichiers;
  assert.equal(await fichiers.supprimerDossierVide('Partage'), false);
  plugin.app.vault.adapter.list = async () => ({ files: [], folders: [] });
  plugin.app.vault.adapter.rmdir = async (chemin, recursif) => { suppressions++; assert.equal(recursif, false); throw Error('Un fichier vient d’arriver'); };
  assert.equal(await fichiers.supprimerDossierVide('Partage'), false);
  assert.equal(suppressions, 1);
  await assert.rejects(fichiers.supprimerDossierVide('CONFIGURATION'), /configuration/);
});

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
  await plugin.ruban.callback();
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

test('renommer le profil conserve la photo sélectionnée sans la partager automatiquement', async () => {
  const { navigateur } = navigateurPhoto();
  const { plugin, rendu } = charger(ETAT_TEST, navigateur); await plugin.onload();
  const ecritures = []; let preferences = 0, affichages = 0;
  plugin.memoriserPreferences = async () => { preferences++; };
  const afficher = plugin.afficher.bind(plugin); plugin.afficher = () => { affichages++; afficher(); };
  plugin.moteur.api = async (methode, route, corps) => {
    if (methode === 'GET') return { json: async () => INFO_TEST };
    ecritures.push(JSON.parse(JSON.stringify(corps)));
    return { json: async () => ({ id: 'm1', nom: corps.nom || 'Ancien nom retourné par une réponse photo', avatar: corps.avatar ?? JPEG_TEST }) };
  };
  plugin.ruban.callback(); await rendu.boutons.get('Mon profil')();
  const champ = rendu.champs.find((entree) => entree.nom === 'Nom affiché').champ;
  assert.equal(champ.value, 'Membre test');
  const photo = rendu.elements.find((element) => element.attrs.type === 'file');
  photo.files = [fichierPhoto()]; await photo.onchange();
  champ.change('  Nouveau nom  ');
  assert.equal(ecritures.length, 0);
  await rendu.boutons.get('Enregistrer le nom')();
  assert.deepEqual(ecritures, [{ nom: 'Nouveau nom' }]);
  assert.equal(plugin.etat.prenom, 'Nouveau nom');
  assert.equal(rendu.sauvegarde.prenom, 'Nouveau nom');
  assert.equal(champ.value, 'Nouveau nom'); assert.equal(preferences, 1); assert.equal(affichages, 1);
  assert.ok(rendu.elements.some((element) => element.attrs.attr?.alt === 'Photo de Nouveau nom'));
  await rendu.boutons.get('Enregistrer la photo')();
  assert.deepEqual(ecritures[1], { avatar: JPEG_TEST });
  assert.equal(plugin.etat.prenom, 'Nouveau nom');
});

test('un nom vide ou trop long est refusé localement et un refus serveur conserve le nom', async () => {
  const { plugin, rendu } = charger(ETAT_TEST); await plugin.onload();
  let ecritures = 0, statut = 400;
  plugin.moteur.api = async (methode) => {
    if (methode === 'GET') return { json: async () => INFO_TEST };
    ecritures++; const erreur = new Error('Refus'); erreur.statut = statut; throw erreur;
  };
  plugin.ruban.callback(); await rendu.boutons.get('Mon profil')();
  const champ = rendu.champs.find((entree) => entree.nom === 'Nom affiché').champ;
  for (const nom of ['   ', 'x'.repeat(61)]) {
    champ.change(nom); await rendu.boutons.get('Enregistrer le nom')();
    assert.ok(rendu.textes.some((texte) => texte.includes('de 1 à 60 caractères')));
  }
  assert.equal(ecritures, 0);
  champ.change('Nom valide'); await rendu.boutons.get('Enregistrer le nom')();
  assert.equal(ecritures, 1); assert.equal(plugin.etat.prenom, ETAT_TEST.prenom);
  assert.ok(rendu.textes.some((texte) => texte.includes('Nom refusé par le serveur')));
  statut = 403; await rendu.boutons.get('Enregistrer le nom')();
  assert.equal(plugin.etat.prenom, ETAT_TEST.prenom);
  assert.ok(rendu.textes.some((texte) => texte.includes('Accès refusé')));
});

test('un nom confirmé par le serveur reste en mémoire si sa sauvegarde locale échoue', async () => {
  const { plugin, rendu } = charger(ETAT_TEST); await plugin.onload();
  let preferences = 0;
  plugin.memoriserPreferences = async () => { preferences++; };
  plugin.saveData = async () => { throw new Error('disque indisponible'); };
  plugin.moteur.api = async (methode) => ({ json: async () => methode === 'GET' ? INFO_TEST : { id: 'm1', nom: 'Nom confirmé', avatar: JPEG_TEST } });
  plugin.ruban.callback(); await rendu.boutons.get('Mon profil')();
  const champ = rendu.champs.find((entree) => entree.nom === 'Nom affiché').champ;
  champ.change('Nom confirmé'); await rendu.boutons.get('Enregistrer le nom')();
  assert.equal(plugin.etat.prenom, 'Nom confirmé'); assert.equal(champ.value, 'Nom confirmé'); assert.equal(preferences, 1);
  assert.ok(rendu.textes.some((texte) => texte.includes('Nom mis à jour sur le serveur') && texte.includes('sauvegarde locale a échoué')));
  assert.equal(rendu.textes.some((texte) => texte.includes('Nom non enregistré')), false);
});

test('fermer pendant un renommage conserve le succès pour le même coffre sans recréer le panneau', async () => {
  for (const changerCoffre of [false, true]) {
    const { plugin, rendu } = charger(ETAT_TEST); await plugin.onload();
    let terminer; plugin.memoriserPreferences = async () => {};
    plugin.moteur.api = async (methode) => methode === 'GET' ? { json: async () => INFO_TEST } : new Promise((resolve) => { terminer = resolve; });
    plugin.ruban.callback(); await rendu.boutons.get('Mon profil')();
    rendu.champs.find((entree) => entree.nom === 'Nom affiché').champ.change('Nom en cours');
    const renommage = rendu.boutons.get('Enregistrer le nom')();
    rendu.modal.onClose();
    if (changerCoffre) plugin.etat.coffreId = 'autre';
    terminer({ json: async () => ({ id: 'm1', nom: 'Nom en cours', avatar: JPEG_TEST }) });
    await renommage;
    assert.equal(plugin.etat.prenom, changerCoffre ? ETAT_TEST.prenom : 'Nom en cours');
    assert.equal(rendu.modal.contentEl.enfants.length, 0); assert.equal(rendu.boutons.has('Enregistrer le nom'), false);
  }
});

// Faux coffre qui se comporte comme un disque Windows : « S3/PApp3 » et « S3/PAPP3 » sont le même dossier pour le système,
// mais l'index d'Obsidian les distingue.
function vaultSansCasse(obsidian, { dossiers = [], fichiers = {} } = {}) {
  const elements = new Map();
  const dossier = (path) => Object.assign(new obsidian.TFolder(), { path });
  const fichier = (path, contenu) => Object.assign(new obsidian.TFile(), { path, contenu, stat: { mtime: 1, size: contenu.byteLength } });
  for (const d of dossiers) elements.set(d, dossier(d));
  for (const [path, contenu] of Object.entries(fichiers)) elements.set(path, fichier(path, contenu));
  const existe = (path) => [...elements.keys()].some((k) => k.toLowerCase() === path.toLowerCase());
  return {
    elements,
    configDir: 'configuration',
    getFiles: () => [...elements.values()].filter((e) => e instanceof obsidian.TFile),
    getAllLoadedFiles: () => [...elements.values()],
    getAbstractFileByPath: (path) => elements.get(path) || null,
    createFolder: async (path) => { if (existe(path)) throw new Error('Folder already exists.'); elements.set(path, dossier(path)); },
    createBinary: async (path, contenu) => { if (existe(path)) throw new Error('File already exists.'); elements.set(path, fichier(path, contenu)); },
    modifyBinary: async (f, contenu) => { f.contenu = contenu; },
    rename: async (element, vers) => {
      const avant = element.path;
      for (const [k, e] of [...elements]) {
        if (k !== avant && !k.startsWith(avant + '/')) continue;
        elements.delete(k); e.path = vers + k.slice(avant.length); elements.set(e.path, e);
      }
    },
    adapter: { exists: async (path) => existe(path) },
  };
}

test('sur un disque insensible à la casse, un dossier existant prend la casse du serveur au lieu de faire échouer la synchro', async () => {
  const { plugin, obsidian } = charger({});
  const vault = vaultSansCasse(obsidian, {
    dossiers: ['S3', 'S3/PApp3', 'S3/PApp3/TP'],
    fichiers: { 'S3/PApp3/TP/_dossier.md': new TextEncoder().encode('ancien').buffer },
  });
  Object.assign(plugin.app.vault, vault, { adapter: vault.adapter });
  await plugin.onload();
  const nouveau = new TextEncoder().encode('chez Paul').buffer;
  await plugin.moteur.fichiers.ecrire('S3/PAPP3/TP/_dossier.md', nouveau);
  assert.deepEqual([...vault.elements.keys()].sort(), ['S3', 'S3/PAPP3', 'S3/PAPP3/TP', 'S3/PAPP3/TP/_dossier.md']);
  assert.equal(vault.elements.get('S3/PAPP3/TP/_dossier.md').contenu, nouveau);
  // Le même fichier, écrit une seconde fois, reste unique.
  await plugin.moteur.fichiers.ecrire('S3/PAPP3/TP/_dossier.md', nouveau);
  assert.equal(vault.getFiles().length, 1);
  // La suppression de l'ancien nom (renommage fait par l'ami) ne touche pas le fichier désormais nommé autrement.
  await plugin.moteur.fichiers.supprimer('S3/PApp3/TP/_dossier.md');
  assert.equal(vault.getFiles().length, 1);
});

test("l'état « fichiers à vérifier » et le message expliquent quel fichier n'a pas pu être écrit", async () => {
  const { plugin } = charger({ ...ETAT_TEST });
  await plugin.onload();
  plugin.moteur.signaler('fichier-bloque', 'S3/PAPP3/cours.pdf', new Error('Le dossier existe déjà'));
  assert.equal(plugin.titreStatut(), 'fichiers à vérifier');
  assert.match(plugin.texteBloques(), /S3\/PAPP3\/cours\.pdf.*Le dossier existe déjà.*Le reste continue/);
  plugin.moteur.signaler('synchro');
  assert.equal(plugin.texteBloques(), '');
});

test("l'erreur affichée distingue une vraie coupure de connexion d'un problème local", () => {
  const { interne } = charger({});
  const reseau = Object.assign(new Error('ENOTFOUND'), { reseau: true });
  assert.match(interne.expliquerErreur(reseau), /serveur ne répond pas/);
  const local = interne.expliquerErreur(new Error('Le dossier existe déjà'));
  assert.match(local, /Le dossier existe déjà/);
  assert.doesNotMatch(local, /Vérifie ta connexion/);
});

test('un dossier supprimé par un ami disparaît même s’il ne contient que des fichiers parasites du système', async () => {
  const { plugin } = charger({});
  const retires = [];
  let contenu = { files: ['Cours/Thumbs.db', 'Cours/.DS_Store'], folders: [] };
  plugin.app.vault.adapter = {
    list: async () => contenu,
    remove: async (chemin) => { retires.push(chemin); },
    rmdir: async (chemin, recursif) => { assert.equal(recursif, false); retires.push('dossier:' + chemin); },
    exists: async () => true,
  };
  await plugin.onload();
  assert.equal(await plugin.moteur.fichiers.supprimerDossierVide('Cours'), true);
  assert.deepEqual(retires, ['Cours/Thumbs.db', 'Cours/.DS_Store', 'dossier:Cours']);
  // Un vrai fichier, même caché, protège le dossier.
  retires.length = 0;
  contenu = { files: ['Cours/Thumbs.db', 'Cours/.secret'], folders: [] };
  assert.equal(await plugin.moteur.fichiers.supprimerDossierVide('Cours'), false);
  assert.deepEqual(retires, []);
});

test('le garde-fou prévient une seule fois et la confirmation relance la synchro', async () => {
  const { plugin, rendu } = charger({ ...ETAT_TEST });
  await plugin.onload();
  let confirmations = 0;
  plugin.moteur.autoriserSuppressions = () => { confirmations++; };
  plugin.moteur.suppressionsEnAttente = () => 30;
  plugin.lancer = async () => {};
  plugin.moteur.signaler('garde-fou', 30); rendu.notice = '';
  plugin.moteur.signaler('garde-fou', 30);
  assert.equal(rendu.notice, '', 'le même message n’est pas répété à chaque synchro');
  assert.equal(plugin.titreStatut(), 'fichiers à vérifier');
  await plugin.confirmerSuppressions();
  assert.equal(confirmations, 1);
});

test('la version annoncée au serveur est celle du manifeste, et la comparaison est numérique', () => {
  const { interne } = charger({});
  const manifeste = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(interne.VERSION, manifeste.version);
  assert.equal(interne.comparerVersions('0.1.4', '0.1.5'), -1);
  assert.equal(interne.comparerVersions('0.1.10', '0.1.5'), 1);
  assert.equal(interne.comparerVersions('0.1.5', '0.1.5'), 0);
});

test('un ami qui n’a pas la dernière version est signalé une seule fois, avec son nom', async () => {
  const { plugin, rendu } = charger({ ...ETAT_TEST });
  await plugin.onload();
  const info = { moiId: 'moi', membres: [{ id: 'moi', nom: 'Moi', version: '0.1.5' }, { id: 'a', nom: 'Bruno', version: null }, { id: 'b', nom: 'Chloé', version: '0.1.5' }] };
  plugin.moteur.api = async () => ({ json: async () => info });
  await plugin.verifierVersions();
  assert.match(rendu.notice, /Bruno/);
  assert.doesNotMatch(rendu.notice, /Chloé|Moi/);
  rendu.notice = ''; plugin.derniereVerifVersions = 0;
  await plugin.verifierVersions();
  assert.equal(rendu.notice, '', 'pas de répétition tant que la situation ne change pas');
  info.membres[1].version = '0.1.5'; plugin.derniereVerifVersions = 0;
  await plugin.verifierVersions();
  assert.equal(rendu.notice, '');
});
