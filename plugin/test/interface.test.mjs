import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function charger(etat, navigateur = {}) {
  const rendu = { textes: [], boutons: new Map(), elements: [], champs: [], ouvertures: 0, commandes: new Map(), notices: [] };
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
      addCommand(commande) { rendu.commandes.set(commande.id, commande); }
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
    Notice: class { constructor(text) { rendu.notice = text; rendu.notices.push(text); } },
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

test('lignes modifiées : apparues ou changées, sans les lignes vides, avec les comptes', () => {
  const { interne } = charger({});
  const r = interne.lignesModifiees(['a', 'b', '', 'c'].join('\n'), ['a', 'b modifiée', '', '', 'c', 'd'].join('\n'));
  assert.deepEqual([...r.lignes], ['b modifiée', 'd']);
  assert.equal(r.ajouts, 3);
  assert.equal(r.suppressions, 1);
  assert.equal(interne.echapperCss('S3/"x"\\y.md'), 'S3/\\"x\\"\\\\y.md');
  assert.equal(interne.couleurAuteur('Bruno'), interne.couleurAuteur('Bruno'), 'une personne garde sa couleur');
  assert.equal(interne.ilYa(Date.now() - 5 * 60_000), 'il y a 5 min');
});

test('ce qu’un ami modifie devient « à voir » : statut, panneau, puis « Vu »', async () => {
  const { plugin, rendu } = charger({ ...ETAT_TEST }, { setTimeout: (f) => { f(); return 0; } });
  await plugin.onload();
  plugin.moteur.api = async () => ({ json: async () => ({ ...INFO_TEST, changements: [] }) });
  plugin.moteur.signaler('modifie-par', 'S3/ENER3/Cours.md', { auteur: 'Bruno', le: Date.now(), lignes: ['ligne changée'], ajouts: 1, suppressions: 0, nouveau: false, texte: true });
  assert.equal(plugin.nombreAVoir(), 1);
  assert.deepEqual([...plugin.etat.aVoir['S3/ENER3/Cours.md'].lignes], ['ligne changée']);
  let barre = ''; plugin.barre.setText = (t) => { barre = t; }; plugin.afficher();
  assert.match(barre, /1 à voir/);
  await plugin.ruban.callback();
  assert.ok(rendu.textes.includes('À voir (1)'));
  assert.ok(rendu.textes.includes('Cours.md'), 'le nom du fichier, pas le chemin entier');
  assert.ok(rendu.textes.includes('S3/ENER3'), 'le dossier à part');
  assert.ok(rendu.textes.some((t) => t.startsWith('Bruno · +1 ligne ·')));
  // Une seconde modification de la même note s'ajoute à la première.
  plugin.moteur.signaler('modifie-par', 'S3/ENER3/Cours.md', { auteur: 'Bruno', le: Date.now(), lignes: ['autre ligne'], ajouts: 1, suppressions: 1, nouveau: false, texte: true });
  assert.deepEqual([...plugin.etat.aVoir['S3/ENER3/Cours.md'].lignes].sort(), ['autre ligne', 'ligne changée']);
  await rendu.boutons.get('Marquer S3/ENER3/Cours.md comme vu')();
  assert.equal(plugin.nombreAVoir(), 0);
  assert.equal(rendu.sauvegarde.aVoir['S3/ENER3/Cours.md'], undefined, 'l’état « vu » est enregistré');
});

test('les modifications de plus d’une semaine ne sont plus « à voir » au démarrage', async () => {
  const vieux = Date.now() - 8 * 24 * 3600_000;
  const { plugin } = charger({ ...ETAT_TEST, aVoir: { 'ancien.md': { auteurs: ['Bruno'], le: vieux, lignes: [] }, 'recent.md': { auteurs: ['Bruno'], le: Date.now(), lignes: [] } } });
  await plugin.onload();
  assert.deepEqual([...Object.keys(plugin.etat.aVoir)], ['recent.md']);
});

test('présence : on voit qui est en ligne et sur quelle note, et une note privée n’est jamais annoncée', async () => {
  const { plugin, rendu } = charger({ ...ETAT_TEST, dossiersIgnores: 'Perso' }, { setTimeout: (f) => { f(); return 0; } });
  plugin.app.workspace.getActiveFile = () => ({ path: 'Cours.md' });
  await plugin.onload();
  let barre = ''; plugin.barre.setText = (t) => { barre = t; };
  plugin.majPresence([{ id: 'b', nom: 'Bruno', chemin: 'Autre.md' }]);
  plugin.majPresence([{ id: 'b', nom: 'Bruno', chemin: 'Cours.md' }]);
  assert.match(rendu.notice, /Bruno est aussi sur cette note/);
  assert.match(barre, /Bruno en ligne/);
  assert.equal(plugin.presenceSur('Cours.md')[0].nom, 'Bruno');
  const envois = [];
  plugin.moteur.api = async (methode, chemin, corps) => { envois.push(corps); return { json: async () => ({ presence: [] }) }; };
  await plugin.annoncerPresence('Perso/journal.md');
  assert.equal(envois[0].chemin, null, 'un dossier non partagé reste secret');
  await plugin.annoncerPresence('Cours.md');
  assert.equal(envois[1].chemin, 'Cours.md');
  plugin.etat.presenceMasquee = true;
  await plugin.annoncerPresence('Cours.md');
  assert.equal(envois[2].parti, true, 'présence masquée : on part');
  assert.equal(envois[2].masquee, true, 'le serveur masque aussi la dernière activité');
  plugin.moteur.api = async () => { throw Object.assign(new Error('absent'), { statut: 404 }); };
  plugin.etat.presenceMasquee = false;
  await plugin.annoncerPresence('Cours.md');
  assert.equal(plugin.presenceIndisponible, true, 'ancien serveur : on n’insiste pas');
});

test('les dernières visites se lisent en minutes, heures et jours, sans inventer une première connexion', () => {
  const { interne } = charger({});
  const maintenant = new Date(2026, 4, 12, 15).getTime();
  assert.equal(interne.derniereActivite(null, maintenant), 'pas encore connecté');
  assert.equal(interne.derniereActivite(undefined, maintenant), 'pas encore connecté');
  assert.equal(interne.derniereActivite(NaN, maintenant), 'pas encore connecté');
  assert.equal(interne.derniereActivite(maintenant - 12 * 60_000, maintenant), 'vu il y a 12 min');
  assert.equal(interne.derniereActivite(maintenant - 2 * 3600_000, maintenant), 'vu il y a 2 h');
  assert.equal(interne.derniereActivite(new Date(2026, 4, 11, 23).getTime(), maintenant), 'vu hier');
  assert.equal(interne.derniereActivite(maintenant - 3 * 86400_000, maintenant), 'vu il y a 3 j');
  assert.equal(interne.derniereActivite(maintenant - 10 * 86400_000, maintenant), `vu ${new Date(maintenant - 10 * 86400_000).toLocaleDateString('fr-FR')}`);
  assert.equal(interne.resumePresence([{ id: 'moi', nom: 'Moi' }, { id: 'b', nom: 'Bruno', vu_le: maintenant - 2 * 3600_000 }], [], 'moi', maintenant), 'Personne d’autre en ligne · Bruno vu il y a 2 h');
});

test('les arrivées se détectent par identifiant, une seule fois et à partir du premier résultat réussi', () => {
  const { interne } = charger({});
  const ami = { id: 'b', nom: 'Bruno' }, autre = { id: 'c', nom: 'Bruno' };
  const maintenant = 1_800_000_000_000;
  assert.equal(interne.arriveesPresence(null, [ami], {}, maintenant).length, 0);
  assert.equal(interne.arriveesPresence([], [ami, ami], {}, maintenant).length, 1);
  assert.equal(interne.arriveesPresence([ami], [ami, autre], {}, maintenant)[0].id, 'c');
  assert.equal(interne.arriveesPresence([ami], [], {}, maintenant).length, 0);
  assert.equal(interne.arriveesPresence([], [ami], {}, maintenant, false).length, 0);
  assert.equal(interne.arriveesPresence([], [ami], { ':b': maintenant - 30 * 60_000 + 1 }, maintenant).length, 0);
  assert.equal(interne.arriveesPresence([], [ami], { ':b': maintenant - 30 * 60_000 }, maintenant).length, 1);
});

test('connexion d’un ami : pas d’alerte au démarrage, anti-répétition conservée après redémarrage', async () => {
  let horloge = 1_800_000_000_000;
  const navigateur = { Date: class extends Date { static now() { return horloge; } }, setTimeout: (f) => { f(); return 0; } };
  const { plugin, rendu } = charger({ ...ETAT_TEST }, navigateur);
  await plugin.onload();
  plugin.app.workspace.getActiveFile = () => ({ path: 'Cours.md' });
  const ami = { id: 'b', nom: 'Bruno', chemin: 'Cours.md' };
  plugin.majPresence([ami]);
  assert.deepEqual(rendu.notices, [], 'aucune notification pour un ami déjà là au démarrage');
  plugin.majPresence([]);
  plugin.majPresence([ami]);
  assert.deepEqual(rendu.notices, ['Bruno vient de se connecter']);
  plugin.majPresence([ami]);
  plugin.majPresence([]);
  horloge += 29 * 60_000;
  plugin.majPresence([ami]);
  assert.equal(rendu.notices.length, 1, 'un retour rapide sur la même note reste silencieux');
  const redemarrage = charger(rendu.sauvegarde, navigateur);
  await redemarrage.plugin.onload();
  redemarrage.plugin.majPresence([]);
  redemarrage.plugin.majPresence([ami]);
  assert.equal(redemarrage.rendu.notices.length, 0, 'la limite survit au redémarrage');
  redemarrage.plugin.majPresence([]);
  horloge += 60_000;
  redemarrage.plugin.majPresence([ami]);
  assert.deepEqual(redemarrage.rendu.notices, ['Bruno vient de se connecter']);
});

test('la commande désactive les alertes, garde le choix et ne signale pas un ami déjà présent à la réactivation', async () => {
  const { plugin, rendu } = charger({ ...ETAT_TEST }, { setTimeout: (f) => { f(); return 0; } });
  await plugin.onload();
  plugin.app.workspace.getActiveFile = () => ({ path: 'Cours.md' });
  const commande = rendu.commandes.get('prevenir-connexions');
  assert.match(commande.name, /Prévenir quand un ami se connecte/);
  await commande.callback();
  assert.equal(rendu.sauvegarde.prevenirConnexions, false);
  const notices = rendu.notices.length;
  plugin.majPresence([]);
  plugin.majPresence([{ id: 'b', nom: 'Bruno', chemin: 'Cours.md' }]);
  assert.equal(rendu.notices.length, notices);
  await commande.callback();
  assert.equal(rendu.sauvegarde.prevenirConnexions, true);
  plugin.majPresence([{ id: 'b', nom: 'Bruno', chemin: 'Cours.md' }]);
  assert.equal(rendu.notices.filter((n) => n === 'Bruno vient de se connecter').length, 0);
  plugin.majPresence([]);
  plugin.majPresence([{ id: 'b', nom: 'Bruno', chemin: null }]);
  assert.equal(rendu.notices.at(-1), 'Bruno vient de se connecter');
});

test('le panneau affiche les amis présents, leur note et leurs dernières visites, puis suit un départ', async () => {
  const maintenant = new Date(2026, 4, 12, 15).getTime();
  const { plugin, rendu } = charger({ ...ETAT_TEST }, { Date: class extends Date { static now() { return maintenant; } }, setTimeout: (f) => { f(); return 0; } });
  await plugin.onload();
  plugin.moteur.api = async () => ({ json: async () => ({ rev: 1, moiId: 'moi', changements: [], membres: [
    { id: 'moi', nom: 'Moi' }, { id: 'b', nom: 'Bruno', vu_le: maintenant - 12 * 60_000 },
    { id: 'c', nom: 'Camille', vu_le: new Date(2026, 4, 11, 23).getTime() }, { id: 'd', nom: 'Alex', vu_le: null },
  ] }) });
  plugin.majPresence([{ id: 'b', nom: 'Bruno', chemin: 'Cours/TD.md' }]);
  await plugin.ruban.callback();
  await rendu.modal.tableau.chargement;
  const statuts = () => rendu.elements.filter((e) => e.attrs.cls === 'cordee-presence-membre');
  assert.ok(rendu.textes.includes('Bruno est en ligne'));
  assert.ok(statuts().some((e) => e.textContent === 'en ligne · sur TD.md' && e.attrs.attr['data-en-ligne'] === 'true'));
  assert.ok(statuts().some((e) => e.textContent === 'vu hier'));
  assert.ok(statuts().some((e) => e.textContent === 'pas encore connecté'));
  plugin.majPresence([]);
  await new Promise((ok) => setImmediate(ok));
  assert.ok(statuts().some((e) => e.textContent === 'vu il y a 12 min'));
  assert.ok(rendu.textes.includes('Personne d’autre en ligne · Bruno vu il y a 12 min'));
});

test('la barre d’état ajoute une pastille aux noms en ligne et la retire au départ', async () => {
  const { plugin, rendu, interne } = charger({ ...ETAT_TEST });
  await plugin.onload();
  await plugin.ruban.callback();
  const barre = rendu.modal.contentEl;
  interne.afficherBarrePresence(barre, 'Cordée : prêt', ['Bruno']);
  assert.equal(barre.enfants.find((e) => e.attrs.cls === 'cordee-presence-barre').textContent, 'Bruno en ligne');
  // Le vrai setText d'Obsidian remplace les enfants de la barre.
  barre.setText = function (texte) { this.enfants = []; this.textContent = texte; };
  interne.afficherBarrePresence(barre, 'Cordée : prêt', []);
  assert.equal(barre.enfants.length, 0);
  assert.equal(barre.textContent, 'Cordée : prêt');
});

test('un ami modifie la note ouverte : une alerte le dit, ses lignes sont « à voir »', async () => {
  const { plugin, rendu } = charger({ ...ETAT_TEST }, { setTimeout: (f) => { f(); return 0; } });
  plugin.app.workspace.getActiveFile = () => ({ path: 'Cours.md' });
  await plugin.onload();
  plugin.moteur.signaler('modifie-par', 'Cours.md', { auteur: 'Bruno', le: Date.now(), lignes: ['x'], ajouts: 2, suppressions: 1, nouveau: false, texte: true });
  assert.match(rendu.notice, /Bruno vient de modifier cette note \(\+2 lignes −1 ligne\)/);
});

test('restaurer une version : téléchargée puis écrite, et la note n’est plus « à voir »', async () => {
  const { plugin } = charger({ ...ETAT_TEST, aVoir: { 'a.md': { auteurs: ['Bruno'], le: Date.now(), lignes: [] } } }, { setTimeout: (f) => { f(); return 0; } });
  await plugin.onload();
  const ecrits = [];
  plugin.moteur.telecharger = async (hash) => new TextEncoder().encode('version ' + hash).buffer;
  plugin.moteur.fichiers.ecrire = async (chemin, buf) => { ecrits.push([chemin, new TextDecoder().decode(buf)]); };
  plugin.programmer = () => {};
  await plugin.restaurer('a.md', 'h1');
  assert.deepEqual(ecrits, [['a.md', 'version h1']]);
  assert.equal(plugin.etat.aVoir['a.md'], undefined);
});

test('comparaison : « Restaurer » demande une confirmation avant de remplacer la note', async () => {
  const { plugin, rendu, interne } = charger({ ...ETAT_TEST });
  await plugin.onload();
  const restaures = [];
  plugin.restaurer = async (chemin, hash) => { restaures.push([chemin, hash]); };
  plugin.moteur.api = async () => ({ json: async () => ({ raison: null, avant: 'a', apres: 'b', changement: { rev: 5, chemin: 'a.md', hash: 'h2', avantHash: 'h1', auteur: 'Bruno', auteurId: 'p', le: Date.now(), supprime: false, type: 'fichier' } }) });
  await new interne.RevisionModal(plugin.app, plugin, 5, null).open();
  assert.ok(rendu.boutons.has('Restaurer cette version'));
  assert.ok(rendu.boutons.has('Revenir à la version d’avant'));
  await rendu.boutons.get('Revenir à la version d’avant')();
  assert.deepEqual(restaures, [], 'le premier clic ne fait que demander confirmation');
  const confirmer = [...rendu.boutons.keys()].find((k) => k.startsWith('Confirmer'));
  await rendu.boutons.get(confirmer)();
  assert.deepEqual(restaures, [['a.md', 'h1']]);
});

test('historique d’une note : chaque version avec son auteur, la plus récente marquée', async () => {
  const { plugin, rendu, interne } = charger({ ...ETAT_TEST });
  await plugin.onload();
  let demande = '';
  plugin.moteur.api = async (m, chemin) => { demande = chemin; return { json: async () => ({ membres: [], changements: [
    { rev: 9, chemin: 'S3/a.md', auteur: 'Bruno', auteurId: 'p', le: Date.now() - 60_000, hash: 'h2', avantHash: 'h1', supprime: false },
    { rev: 3, chemin: 'S3/a.md', auteur: 'raf', auteurId: 'r', le: Date.now() - 3_600_000, hash: 'h1', avantHash: null, supprime: false },
  ] }) }; };
  await new interne.HistoriqueModal(plugin.app, plugin, 'S3/a.md').open();
  assert.match(demande, /historique\?chemin=S3%2Fa\.md/);
  assert.ok(rendu.textes.includes('a.md'));
  assert.ok(rendu.textes.some((t) => t.startsWith('Bruno · ')));
  assert.ok(rendu.textes.some((t) => t.includes('version actuelle')));
  assert.ok(rendu.boutons.has('Comparer la révision 3'));
});

const ICS_TEST = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART:20261112T070000Z', 'DTEND:20261112T090000Z', 'SUMMARY:TD ENER3', 'LOCATION:Salle 104', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART:20261113T225900Z', 'DTEND:20261113T225900Z', 'SUMMARY:Rendu TP2', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const LIEN_MOODLE = 'https://moodle.exemple.fr/calendar/export_execute.php?userid=42&authtoken=CLESECRETE';

test('calendrier ajouté : lu, typé, mis en cache ; une erreur est expliquée sans montrer le lien', async () => {
  const { plugin } = charger({ ...ETAT_TEST });
  await plugin.onload();
  plugin.lireUrlCalendrier = async () => ICS_TEST;
  const s = await plugin.ajouterCalendrier('', LIEN_MOODLE);
  assert.equal(s.type, 'moodle');
  assert.equal(s.nom, 'Moodle');
  assert.equal(plugin.etat.cacheCalendriers[s.id].evenements.length, 2);
  const evts = await plugin.evenementsEntre(new Date(2026, 10, 9).getTime(), new Date(2026, 10, 16).getTime());
  assert.deepEqual([...evts.map((e) => e.titre)], ['TD ENER3', 'Rendu TP2']);
  assert.equal(evts[0].type, 'moodle');
  plugin.lireUrlCalendrier = async () => { throw new Error('le serveur du calendrier répond 403'); };
  await plugin.actualiserCalendriers({ forcer: true });
  const cache = plugin.etat.cacheCalendriers[s.id];
  assert.equal(cache.erreur, 'le serveur du calendrier répond 403');
  assert.equal(cache.evenements.length, 2, 'la dernière version lue est gardée');
  await assert.rejects(plugin.ajouterCalendrier('X', 'ftp://exemple.fr/a.ics'), /https:/);
});

test('réglages : la section Calendriers montre le domaine du lien, jamais la clé', async () => {
  const { plugin, rendu } = charger({ ...ETAT_TEST, calendriers: [{ id: 'm', nom: 'Moodle', url: LIEN_MOODLE, type: 'moodle' }], cacheCalendriers: { m: { maj: Date.now(), evenements: [{}, {}], erreur: null } } });
  await plugin.onload();
  plugin.onglet.display();
  assert.ok(rendu.textes.includes('Calendriers'));
  assert.ok(rendu.boutons.has('Ajouter pour moi'));
  assert.ok(rendu.boutons.has('Ajouter pour toute la cordée'));
  assert.ok(rendu.boutons.has('Retirer'));
  assert.equal(rendu.textes.some((t) => String(t).includes('CLESECRETE')), false);
});

test('agenda de la cordée : un créneau s’ajoute à la note partagée, et apparaît dans la semaine', async () => {
  const { plugin, obsidian } = charger({ ...ETAT_TEST, prenom: 'raf' });
  await plugin.onload();
  let contenu = null; let note = null;
  plugin.app.vault.getAbstractFileByPath = (chemin) => (chemin === 'Agenda de la cordée.md' ? note : null);
  plugin.app.vault.create = async (chemin, texte) => { contenu = texte; note = Object.assign(new obsidian.TFile(), { path: chemin }); };
  plugin.app.vault.process = async (f, modifier) => { contenu = modifier(contenu); };
  plugin.app.vault.cachedRead = async () => contenu;
  await plugin.ajouterCreneau({ jour: '2026-11-12', debut: '14:00', fin: '16:00', titre: 'Révision ENER3', lieu: 'BU' });
  await plugin.ajouterCreneau({ jour: '2026-11-15', titre: 'Rendu rapport' });
  assert.ok(contenu.includes('- 2026-11-12 14:00-16:00 Révision ENER3 @ BU (ajouté par raf)'));
  assert.ok(contenu.trimEnd().endsWith('- 2026-11-15 Rendu rapport (ajouté par raf)'));
  const evts = await plugin.evenementsEntre(new Date(2026, 10, 9).getTime(), new Date(2026, 10, 16).getTime());
  assert.deepEqual([...evts.map((e) => [e.titre, e.type])].map((x) => [...x]), [['Révision ENER3', 'cordee'], ['Rendu rapport', 'cordee']]);
});

test('formulaire de créneau : refuse un titre vide ou une fin avant le début, puis ajoute', async () => {
  const { plugin, rendu, interne } = charger({ ...ETAT_TEST });
  await plugin.onload();
  const ajouts = [];
  plugin.ajouterCreneau = async (c) => { ajouts.push(c); };
  const modal = new interne.CreneauModal(plugin.app, plugin, '2026-11-12');
  modal.open();
  await rendu.boutons.get('Ajouter à l’agenda')();
  assert.ok(rendu.textes.includes('Indique ce qui est prévu.'));
  modal.champs.titre.value = 'Révision'; modal.champs.debut.value = '16:00'; modal.champs.fin.value = '14:00';
  await rendu.boutons.get('Ajouter à l’agenda')();
  assert.ok(rendu.textes.includes('La fin doit être après le début.'));
  modal.champs.fin.value = '18:00';
  await rendu.boutons.get('Ajouter à l’agenda')();
  assert.deepEqual(ajouts.map((a) => [a.jour, a.debut, a.fin, a.titre]), [['2026-11-12', '16:00', '18:00', 'Révision']]);
});

test('la semaine : cours avec horaires, devoir « à rendre », liste par jour ; sans calendrier, une aide', async () => {
  const { plugin, rendu, interne, obsidian } = charger({ ...ETAT_TEST });
  await plugin.onload();
  const lundi = new Date(2026, 10, 9).getTime();
  // Sans aucun calendrier : l'aide pour en ajouter un.
  const c = new obsidian.Modal(plugin.app).contentEl;
  await interne.dessinerSemaine(c, plugin, lundi, () => {});
  assert.ok(rendu.textes.some((t) => String(t).startsWith('Semaine du 9 au 15 novembre')));
  assert.ok(rendu.boutons.has('Ajouter mon emploi du temps'));
  // Avec un emploi du temps et un devoir Moodle.
  plugin.etat.calendriers = [{ id: 'e', nom: 'Emploi du temps', url: 'https://ade.exemple.fr/x', type: 'edt' }, { id: 'm', nom: 'Moodle', url: LIEN_MOODLE, type: 'moodle' }];
  plugin.etat.cacheCalendriers = { e: { maj: Date.now(), evenements: [{ titre: 'TD ENER3', lieu: 'Salle 104', debut: new Date(2026, 10, 12, 8).getTime(), fin: new Date(2026, 10, 12, 10).getTime() }] }, m: { maj: Date.now(), evenements: [{ titre: 'Rendu TP2', debut: new Date(2026, 10, 13, 23, 59).getTime(), fin: new Date(2026, 10, 13, 23, 59).getTime() }] } };
  const evts = await interne.dessinerSemaine(c, plugin, lundi, () => {});
  assert.equal(evts.length, 2);
  assert.ok(rendu.textes.includes('TD ENER3'));
  assert.ok(rendu.textes.includes('08:00–10:00 · Salle 104'));
  assert.ok(rendu.textes.includes('À rendre 23:59 · Rendu TP2'), 'le devoir est dans la ligne « Journée » de la grille');
  assert.ok(rendu.textes.includes('À rendre 23:59'), 'et dans la liste par jour');
  assert.ok(rendu.textes.includes('Rien de prévu.'));
});

test('emploi du temps pour toute la cordée : écrit dans la note commune, lu par chacun ; Moodle refusé', async () => {
  const { plugin, obsidian } = charger({ ...ETAT_TEST, prenom: 'raf' });
  await plugin.onload();
  let contenu = null; let note = null;
  plugin.app.vault.getAbstractFileByPath = (chemin) => (chemin === 'Agenda de la cordée.md' ? note : null);
  plugin.app.vault.create = async (chemin, texte) => { contenu = texte; note = Object.assign(new obsidian.TFile(), { path: chemin }); };
  plugin.app.vault.process = async (f, modifier) => { contenu = modifier(contenu); };
  plugin.app.vault.cachedRead = async () => contenu;
  plugin.lireUrlCalendrier = async () => ICS_TEST;
  await assert.rejects(plugin.ajouterCalendrierPourTous('Moodle', LIEN_MOODLE), /personnel/);
  assert.equal(contenu, null, 'rien n’est écrit pour un lien Moodle');
  // Ce lien était déjà ajouté « pour moi » : la version partagée le remplace, sans doublon.
  plugin.etat.calendriers = [{ id: 'local', nom: 'EDT', url: 'https://ade.exemple.fr/cal.ics', type: 'edt' }];
  const s = await plugin.ajouterCalendrierPourTous('Emploi du temps S3', 'https://ade.exemple.fr/cal.ics');
  assert.equal(s.partage, true);
  assert.ok(contenu.includes('- [Emploi du temps S3](https://ade.exemple.fr/cal.ics)'));
  assert.equal(plugin.etat.calendriers.length, 0);
  const evts = await plugin.evenementsEntre(new Date(2026, 10, 9).getTime(), new Date(2026, 10, 16).getTime());
  assert.deepEqual([...evts.map((e) => e.titre)], ['TD ENER3', 'Rendu TP2']);
  assert.equal(evts[0].partage, true);
  await plugin.retirerCalendrierPartage('https://ade.exemple.fr/cal.ics');
  assert.equal(contenu.includes('ade.exemple.fr'), false);
  assert.equal((await plugin.evenementsEntre(new Date(2026, 10, 9).getTime(), new Date(2026, 10, 16).getTime())).length, 0);
});
