import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

function charger(etat, navigateur = {}) {
  const rendu = { textes: [], boutons: new Map(), elements: [], champs: [], ouvertures: 0, commandes: new Map(), notices: [] };
  const container = (racine = true) => ({
    enfants: [], attrs: {},
    style: {}, value: '', scrollTop: 0, scrollLeft: 0,
    get scrollHeight() { return this.enfants.length * 40; },
    focus() { rendu.focus = this; },
    scrollIntoView() { rendu.defilement = this; },
    addClass(...classes) { this.classes = [...new Set([...(this.classes || (this.attrs.cls || '').split(' ').filter(Boolean)), ...classes])]; },
    removeClass(...classes) { this.classes = (this.classes || (this.attrs.cls || '').split(' ')).filter((cls) => !classes.includes(cls)); },
    querySelector(tag) { for (const enfant of this.enfants) { if (enfant.tag === tag) return enfant; const trouve = enfant.querySelector(tag); if (trouve) return trouve; } return null; },
    get children() { return this.enfants; },
    appendChild(enfant) { return this.insertBefore(enfant, null); },
    insertBefore(enfant, reference) {
      if (enfant === reference) return enfant;
      if (enfant.parentElement) enfant.parentElement.enfants = enfant.parentElement.enfants.filter((e) => e !== enfant);
      const index = reference ? this.enfants.indexOf(reference) : this.enfants.length;
      this.enfants.splice(index, 0, enfant); enfant.parentElement = this; return enfant;
    },
    remove() {
      this.empty();
      if (rendu.boutons.get(this.labelBouton) === this.actionBouton) rendu.boutons.delete(this.labelBouton);
      rendu.elements = rendu.elements.filter((e) => e !== this);
      if (this.parentElement) this.parentElement.enfants = this.parentElement.enfants.filter((e) => e !== this);
      this.parentElement = null;
    },
    get ownerDocument() { return { createElementNS: (_, tag) => { const enfant = container(false); enfant.tag = tag; enfant.attrs = {}; rendu.elements.push(enfant); return enfant; } }; },
    empty() {
      this.vidages = (this.vidages || 0) + 1;
      this.textContent = '';
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
    getAttribute(nom) { return this.attrs.attr?.[nom] ?? null; },
    setAttribute(nom, valeur) { this.attrs.attr ||= {}; this.attrs.attr[nom] = valeur; this.enregistrerBouton(); },
    replaceWith() { rendu.elements = rendu.elements.filter((element) => element !== this); },
    createEl(tag, attrs = {}) { const enfant = container(false); enfant.tag = tag; enfant.attrs = attrs; enfant.textContent = attrs.text || ''; if (attrs.text) rendu.textes.push(attrs.text); Object.defineProperty(enfant, 'onclick', { set(action) { this.action = action; this.enregistrerBouton(); } }); this.appendChild(enfant); rendu.elements.push(enfant); return enfant; },
  });
  const obsidian = {
    Plugin: class {
      constructor() { this.app = { workspace: { onLayoutReady(callback) { rendu.layout = callback; } }, vault: { configDir: 'configuration', getFiles: () => [] } }; }
      async loadData() { return etat; }
      async saveData(data) { rendu.sauvegarde = JSON.parse(JSON.stringify(data)); }
      addStatusBarItem() { return { setText() {}, onClickEvent(action) { rendu.clicStatut = action; } }; }
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
        const champ = { inputEl: {}, setValue(v) { this.value = v; this.inputEl.value = v; return this; }, setPlaceholder() { return this; }, onChange(action) { this.change = action; return this; } };
        callback(champ); rendu.champs.push({ nom: this.nom, champ }); return this;
      }
      addToggle(callback) {
        const champ = { setValue(v) { this.value = v; return this; }, onChange(action) { this.change = action; return this; } };
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
  const context = { require: () => obsidian, module: { exports: {} }, TextEncoder, TextDecoder, clearTimeout, URL, URLSearchParams, atob, Blob, window: { setInterval: callback => callback }, ...navigateur };
  vm.runInNewContext(readFileSync(new URL('../main.js', import.meta.url), 'utf8'), context);
  return { plugin: new context.module.exports(), rendu, obsidian, interne: context.module.exports.interne, container };
}

// Banc TextFileView volontairement minimal : il exerce les branchements sans
// remplacer la sauvegarde GEII par une écriture cachée dans les tests.
function chargerGeii({ collision = '', sansVue = false, sansExtensions = false } = {}) {
  const banc = charger({}), { plugin, obsidian, container } = banc;
  const vues = new Map(), extensions = new Map(), blocs = new Map();
  plugin.registerView = (id, creer) => vues.set(id, creer);
  plugin.registerMarkdownCodeBlockProcessor = (nom, rendre) => blocs.set(nom, rendre);
  if (!sansExtensions) plugin.registerExtensions = (liste, id) => {
    assert.equal(liste.length, 1, 'une collision ne doit pas bloquer les autres extensions');
    if (liste[0] === collision) throw Error('extension déjà prise');
    extensions.set(liste[0], id);
  };
  if (!sansVue) obsidian.TextFileView = class {
    constructor(leaf) { this.app = leaf.app; this.contentEl = container(); this.demandes = 0; this.requestSave = () => { this.demandes++; }; }
    async save() { await this.app.vault.modify(this.file, this.getViewData()); }
  };
  return { ...banc, vues, extensions, blocs };
}

test('GEII : les API absentes et une extension déjà prise ne bloquent pas le chargement', async () => {
  for (const options of [{ sansVue: true }, { sansExtensions: true }]) {
    const banc = chargerGeii(options); await banc.plugin.onload();
    assert.equal(banc.extensions.size, 0); assert.equal(banc.blocs.size, 2);
    assert.equal(banc.plugin.phase, 'pret');
  }
  const banc = chargerGeii({ collision: 'c' }); await banc.plugin.onload();
  assert.equal(banc.extensions.has('c'), false);
  const vue = banc.vues.get('cordee-geii-code')({ app: banc.plugin.app });
  assert.equal(vue.canAcceptExtension('c'), false); assert.equal(vue.canAcceptExtension('INO'), true);
  for (const extension of ['ino', 'h', 'm', 'py', 'vhd', 'asm', 's', 'asc', 'kicad_sch']) assert.ok(banc.extensions.has(extension));
  assert.equal(banc.extensions.has('kicad_pcb'), false);
});

test('GEII : le code affiche ses lignes, demande la sauvegarde normale et ouvre le logiciel après sauvegarde', async () => {
  const { plugin, vues, rendu } = chargerGeii(); await plugin.onload();
  const ordre = []; plugin.app.vault.modify = async (f, contenu) => ordre.push(['sauve', f.path, contenu]);
  plugin.app.openWithDefaultApp = async chemin => ordre.push(['ouvre', chemin]);
  const vue = vues.get('cordee-geii-code')({ app: plugin.app });
  vue.file = { path: 'tp.ino', name: 'tp.ino' }; vue.setViewData('void setup() {}\nvoid loop() {}', true);
  assert.equal(vue.getViewType(), 'cordee-geii-code'); assert.equal(vue.getDisplayText(), 'tp.ino');
  assert.equal(vue.numerosGeii.textContent, '1\n2');
  vue.champGeii.value = 'ligne 1\nligne 2\n'; vue.champGeii.oninput();
  assert.equal(vue.demandes, 1); assert.equal(vue.numerosGeii.textContent, '1\n2\n3');
  vue.champGeii.scrollTop = 24; vue.champGeii.onscroll(); assert.equal(vue.numerosGeii.scrollTop, 24);
  await rendu.boutons.get('Ouvrir dans le logiciel')();
  assert.deepEqual(ordre, [['sauve', 'tp.ino', 'ligne 1\nligne 2\n'], ['ouvre', 'tp.ino']]);
  plugin.app.vault.modify = async () => { throw Error('Sauvegarde refusée'); };
  await rendu.boutons.get('Ouvrir dans le logiciel')(); assert.equal(ordre.length, 2); assert.equal(rendu.notice, 'Sauvegarde refusée');
  vue.clear(); assert.equal(vue.getViewData(), ''); assert.equal(vue.numerosGeii.textContent, '1');
  delete plugin.app.openWithDefaultApp; await rendu.boutons.get('Ouvrir dans le logiciel')();
  assert.match(rendu.notice, /pas disponible/);
});

test('GEII : LTspice dessine un SVG sûr, ajuste le zoom et ne sauvegarde jamais le schéma', async () => {
  const { plugin, vues, rendu } = chargerGeii(); await plugin.onload();
  plugin.app.vault.modify = () => assert.fail('Un aperçu ne doit jamais écrire');
  let ouvert; plugin.app.openWithDefaultApp = async chemin => { ouvert = chemin; };
  const source = readFileSync(new URL('./exemples/rc.asc', import.meta.url), 'utf8') + '\nTEXT -300 0 Left 2 ;<script>alert(1)</script>';
  const vue = vues.get('cordee-geii-ltspice')({ app: plugin.app }); vue.file = { path: 'rc.asc' };
  vue.setViewData(source, true); assert.equal(vue.getViewData(), source);
  assert.equal(rendu.elements.filter(e => e.tag === 'rect').length, 2);
  assert.equal(rendu.elements.filter(e => e.tag === 'line').length, 4);
  assert.ok(rendu.elements.some(e => e.tag === 'path'));
  assert.ok(rendu.elements.some(e => e.tag === 'text' && e.textContent === 'R1 4.7k'));
  assert.ok(rendu.elements.some(e => e.tag === 'text' && e.textContent === '<script>alert(1)</script>'));
  assert.equal(rendu.elements.some(e => e.tag === 'script' || e.tag === 'textarea'), false);
  const svg = rendu.elements.find(e => e.tag === 'svg');
  assert.match(svg.attrs.attr.viewBox, /^-324 /); const naturelle = parseInt(svg.style.width, 10); assert.ok(naturelle > 0 && svg.style.width.endsWith('px')); assert.equal(svg.style.maxWidth, '100%', 'taille naturelle, sans dépasser la largeur');
  rendu.boutons.get('Agrandir')(); assert.equal(svg.style.width, `${Math.round(naturelle * 1.25)}px`); assert.equal(svg.style.maxWidth, 'none');
  rendu.boutons.get('Ajuster à la largeur')(); assert.equal(svg.style.width, '100%');
  rendu.boutons.get('Réduire')(); assert.equal(svg.style.width, `${Math.round(naturelle)}px`);
  await vue.save(); await rendu.boutons.get('Ouvrir dans LTspice')(); assert.equal(ouvert, 'rc.asc');
  vue.setViewData('Version 4\nSHEET 1 1 1', true); assert.ok(rendu.textes.includes('Aucun élément LTspice reconnu.'));
});

test('GEII : KiCad affiche composants et feuilles, sans éditeur ni écriture à la fermeture', async () => {
  const { plugin, vues, rendu } = chargerGeii(); await plugin.onload();
  plugin.app.vault.modify = () => assert.fail('Un aperçu ne doit jamais écrire');
  let ouvert; plugin.app.openWithDefaultApp = async chemin => { ouvert = chemin; };
  const source = readFileSync(new URL('./exemples/rc.kicad_sch', import.meta.url), 'utf8');
  const vue = vues.get('cordee-geii-kicad')({ app: plugin.app }); vue.file = { path: 'rc.kicad_sch' }; vue.setViewData(source, true);
  for (const texte of ['R1', '4.7k', 'C1', '10uF', 'Resistor_SMD:R_0805_2012Metric', 'Alimentation (5 V)', 'alimentation.kicad_sch']) assert.ok(rendu.textes.includes(texte), texte);
  assert.equal(rendu.elements.some(e => e.tag === 'textarea'), false); assert.equal(vue.getViewData(), source);
  await vue.save(); await rendu.boutons.get('Ouvrir dans KiCad')(); assert.equal(ouvert, 'rc.kicad_sch');
  vue.setViewData('(kicad_sch', true); assert.ok(rendu.textes.some(t => /parenthèse fermante/.test(t)));
  vue.clear(); assert.equal(vue.getViewData(), '');
});

test('GEII : les blocs calc et ltspice rendent résultats, erreurs, contenu brut et liens relatifs', async () => {
  const { plugin, blocs, container, rendu } = chargerGeii({ sansVue: true }); await plugin.onload();
  blocs.get('calc')('R = 4.7kΩ\nC = 10uF\ntau = R*C\nerr = R+C\nsuivant = 2', container());
  for (const texte of ['4,7 kΩ', '10 µF', '47 ms', '2']) assert.ok(rendu.textes.includes(texte));
  assert.ok(rendu.textes.some(t => /Erreur : Unités incompatibles/.test(t)));
  const source = readFileSync(new URL('./exemples/rc.asc', import.meta.url), 'utf8');
  const ctx = { sourcePath: 'TP/note.md' }, fichier = { path: 'TP/rc.asc', extension: 'asc' };
  plugin.app.metadataCache = { getFirstLinkpathDest(chemin, depuis) { assert.equal(chemin, 'rc.asc'); assert.equal(depuis, ctx.sourcePath); return fichier; } };
  plugin.app.vault.read = async f => { assert.equal(f, fichier); return source; };
  await blocs.get('ltspice')('[[rc.asc]]', container(), ctx);
  assert.ok(rendu.elements.some(e => e.tag === 'text' && e.textContent === 'C1 10u'));
  await blocs.get('ltspice')(source, container(), ctx);
  assert.equal(rendu.elements.filter(e => e.tag === 'svg').length, 2);
  plugin.app.metadataCache.getFirstLinkpathDest = () => null;
  await blocs.get('ltspice')('[[absent.asc]]', container(), ctx);
  assert.ok(rendu.textes.some(t => /Fichier .asc introuvable/.test(t)));
});

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

test('une écriture continue part après 200 ms sans repousser la première échéance', async () => {
  let horloge = 1000, id = 0;
  const timers = new Map();
  const { plugin } = charger({ ...ETAT_TEST }, {
    Date: class extends Date { static now() { return horloge; } },
    setTimeout: (f, ms) => { timers.set(++id, { f, ms }); return id; },
    clearTimeout: (n) => timers.delete(n),
  });
  await plugin.onload();
  let synchronisations = 0;
  plugin.lancer = async () => { synchronisations++; };
  plugin.etat.cache['note.md'] = { hash: 'ancien', mtime: 1, taille: 4 };
  plugin.changementLocal({ path: 'note.md' });
  assert.equal(plugin.etat.cache['note.md'], undefined);
  assert.equal([...timers.values()][0].ms, 200);
  horloge = 1100; plugin.changementLocal({ path: 'note.md' });
  horloge = 1190; plugin.changementLocal({ path: 'note.md' });
  assert.equal(timers.size, 1);
  assert.equal(id, 1, 'les frappes suivantes ne repoussent pas le minuteur');
  horloge = 1200;
  const timer = [...timers.values()][0]; timers.clear(); await timer.f();
  assert.equal(synchronisations, 1);
  plugin.changementLocal({ path: 'note.md' });
  assert.equal(id, 2, 'la frappe suivante programme un nouvel envoi');
  plugin.programmer(0);
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].ms, 0, 'une notification distante avance l’échéance');
  plugin.changementLocal({ path: 'configuration/plugins/cordee/data.json' });
  assert.equal(id, 3, 'les réglages privés ne déclenchent rien');
});

test('un renommage vers un dossier exclu synchronise la disparition du chemin partagé', async () => {
  const { plugin } = charger({ ...ETAT_TEST, dossiersIgnores: 'Perso' });
  await plugin.onload();
  const demandes = []; plugin.programmer = (ms) => demandes.push(ms);
  plugin.etat.cache['note.md'] = { hash: 'ancien' };
  plugin.changementLocal({ path: 'Perso/note.md' }, 'note.md');
  assert.equal(plugin.etat.cache['note.md'], undefined);
  assert.deepEqual(demandes, [200]);
  plugin.changementLocal({ path: 'Perso/autre.md' });
  assert.deepEqual(demandes, [200]);
});

test('le flux déclenche immédiatement la réception, s’arrête en pause et reprend sans doublon', async () => {
  const connexions = [], demandes = [];
  const { plugin } = charger({ ...ETAT_TEST, derniereRev: 3 }, {
    AbortController, setTimeout,
    fetch: async (url, options) => {
      let controle;
      const flux = new ReadableStream({ start(c) { controle = c; } });
      options.signal.addEventListener('abort', () => controle.error(Error('arrêt')));
      const envoyer = (rev) => controle.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ rev }) + '\n\n'));
      connexions.push({ url, options, envoyer });
      return new Response(flux, { headers: { 'Content-Type': 'text/event-stream' } });
    },
  });
  await plugin.onload();
  plugin.programmer = (ms) => { if (!plugin.etat.enPause && !plugin.arret) demandes.push(ms); };
  plugin.lancer = async () => {};
  plugin.maintenirFlux(); plugin.maintenirFlux();
  await new Promise(setImmediate);
  assert.equal(connexions.length, 1);
  assert.equal(plugin.fluxRevisions.connecte, true);
  connexions[0].envoyer(3); connexions[0].envoyer(4);
  await new Promise(setImmediate);
  assert.deepEqual(demandes, [0]);
  const premier = plugin.fluxRevisions;
  await plugin.mettreEnPause(true); await premier.termine;
  assert.equal(connexions[0].options.signal.aborted, true);
  assert.equal(plugin.fluxRevisions, null);
  plugin.maintenirFlux(); assert.equal(connexions.length, 1);
  await plugin.mettreEnPause(false); await new Promise(setImmediate);
  assert.equal(connexions.length, 2);
  const second = plugin.fluxRevisions;
  plugin.moteur.api = async () => ({});
  plugin.onunload(); await second.termine;
  assert.equal(connexions[1].options.signal.aborted, true);
});

test('un flux refusé laisse le sondage requestUrl recevoir les changements', async () => {
  let tentatives = 0;
  const { plugin } = charger({ ...ETAT_TEST, derniereRev: 3 }, {
    AbortController, setTimeout,
    fetch: async () => { tentatives++; throw Error('CORS ou réseau indisponible'); },
  });
  await plugin.onload();
  let synchronisations = 0;
  plugin.lancer = async () => { synchronisations++; };
  plugin.moteur.api = async () => ({ json: async () => ({ rev: 4 }) });
  plugin.ecouter(); await plugin.fluxRevisions.termine;
  await plugin.intervalle();
  assert.equal(synchronisations, 1);
  assert.equal(tentatives, 1, 'attendre avant de rouvrir un flux refusé');
  plugin.onunload();
});

test('une réponse de sondage en retard ne relance rien après une pause ou un changement de coffre', async () => {
  for (const changement of ['pause', 'coffre']) {
    const { plugin } = charger({ ...ETAT_TEST, derniereRev: 3 }); await plugin.onload();
    const reponse = Promise.withResolvers();
    let synchronisations = 0;
    plugin.lancer = async () => { synchronisations++; };
    plugin.moteur.api = async () => ({ json: () => reponse.promise });
    plugin.ecouter(); const sondage = plugin.intervalle();
    if (changement === 'pause') await plugin.mettreEnPause(true);
    else plugin.etat.coffreId = 'autre-coffre';
    reponse.resolve({ rev: 4 }); await sondage;
    assert.equal(synchronisations, 0);
    plugin.moteur.api = async () => ({}); plugin.onunload();
  }
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

test('les icônes du panneau utilisent le catalogue ancien, gardent leurs libellés et reprennent après la pause', async () => {
  const { plugin, rendu, obsidian } = charger({ ...ETAT_TEST });
  const noms = new Set(['user', 'settings', 'refresh-cw', 'calendar', 'check', 'rotate-cw', 'pause', 'play']);
  obsidian.setIcon = (el, nom) => { el.empty(); if (noms.has(nom)) el.createEl('svg', { attr: { 'data-icone': nom } }); };
  plugin.lancer = async () => {};
  await plugin.onload(); await plugin.ruban.callback();
  for (const label of ['Mon profil', 'Configurer', 'Synchroniser', 'La semaine', 'Tout marquer comme vu', 'Actualiser', 'Mettre en pause']) {
    const bouton = rendu.elements.find((el) => el.getAttribute('aria-label') === label);
    assert.ok(bouton.querySelector('svg'), label);
    assert.ok(bouton.classes.includes('clickable-icon'), label);
    assert.ok(bouton.classes.includes('cordee-bouton-icone'), label);
    assert.equal(bouton.querySelector('svg').getAttribute('aria-hidden'), 'true');
    assert.equal(bouton.textContent, '');
    assert.ok(rendu.boutons.has(label));
  }
  const pause = rendu.elements.find((el) => el.getAttribute('aria-label') === 'Mettre en pause');
  await plugin.mettreEnPause(true);
  assert.equal(pause.querySelector('svg').getAttribute('data-icone'), 'play');
  assert.ok(rendu.boutons.has('Reprendre'));
  await plugin.mettreEnPause(false);
  assert.equal(pause.querySelector('svg').getAttribute('data-icone'), 'pause');
  assert.equal(pause.children.length, 1, 'les actualisations ne cumulent pas les SVG');
});

test('une API d’icône absente, vide ou en erreur conserve le texte et les actions du panneau', async () => {
  for (const mode of ['absente', 'vide', 'erreur']) {
    const { plugin, rendu, obsidian } = charger({ ...ETAT_TEST });
    if (mode !== 'absente') obsidian.setIcon = (el) => { el.empty(); if (mode === 'erreur') throw Error('Icône indisponible'); };
    let synchros = 0; plugin.lancer = async () => { synchros++; };
    await plugin.onload(); await plugin.ruban.callback();
    for (const [label, texte] of [['Synchroniser', 'Synchroniser'], ['La semaine', 'La semaine'], ['Tout marquer comme vu', 'Tout vu'], ['Mettre en pause', 'Mettre en pause']]) {
      const bouton = rendu.elements.find((el) => el.getAttribute('aria-label') === label);
      assert.equal(bouton.textContent, texte, mode);
      assert.equal(bouton.classes?.includes('cordee-bouton-icone') || false, false);
    }
    await rendu.boutons.get('Synchroniser')(); assert.equal(synchros, 1);
    await plugin.mettreEnPause(true);
    assert.equal(rendu.elements.find((el) => el.getAttribute('aria-label') === 'Reprendre').textContent, 'Reprendre');
  }
});

test('la pause perd son format carré si l’icône de reprise manque, puis retrouve son icône', async () => {
  const { plugin, rendu, obsidian } = charger({ ...ETAT_TEST });
  obsidian.setIcon = (el, nom) => { el.empty(); if (nom !== 'play') el.createEl('svg'); };
  plugin.lancer = async () => {};
  await plugin.onload(); await plugin.ruban.callback();
  const pause = rendu.elements.find((el) => el.getAttribute('aria-label') === 'Mettre en pause');
  await plugin.mettreEnPause(true);
  assert.equal(pause.querySelector('svg'), null);
  assert.equal(pause.textContent, 'Reprendre');
  assert.equal(pause.classes.includes('clickable-icon'), false);
  assert.equal(pause.classes.includes('cordee-bouton-icone'), false);
  await plugin.mettreEnPause(false);
  assert.ok(pause.querySelector('svg'));
  assert.ok(pause.classes.includes('clickable-icon'));
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

test('actualiser en arrière-plan conserve les cartes, les membres et le défilement', async () => {
  const { plugin, rendu } = charger({ ...ETAT_TEST }); await plugin.onload();
  const info = { ...INFO_TEST, changements: [{ rev: 1, auteurId: 'm1', auteur: 'Membre test', chemin: 'note.md', le: 1700000000000 }] };
  plugin.moteur.api = async () => ({ json: async () => info });
  await plugin.ruban.callback();
  const t = rendu.modal.tableau, cartes = [...t.zone.children], membres = [...t.membresEl.children];
  t.zone.scrollTop = 64;
  const vidages = t.zone.vidages;
  const attente = Promise.withResolvers();
  plugin.moteur.api = async () => ({ json: () => attente.promise });
  const actualisation = t.charger();
  assert.deepEqual(t.zone.children, cartes, 'aucun écran de chargement pendant le réseau');
  assert.equal(t.zone.vidages, vidages);
  attente.resolve(info); await actualisation;
  assert.deepEqual(t.zone.children, cartes, 'les nœuds inchangés gardent leur identité');
  assert.deepEqual(t.membresEl.children, membres);
  assert.equal(t.zone.scrollTop, 64);
  const textes = rendu.textes.length;
  plugin.afficher(); plugin.afficher();
  assert.equal(rendu.textes.length, textes, 'un statut identique ne réécrit aucun texte du panneau');
  plugin.moteur.signaler('synchro'); plugin.moteur.signaler('ok');
  assert.deepEqual(t.zone.children, cartes);
  assert.deepEqual(t.membresEl.children, membres);
});

test('les nouvelles révisions insèrent seulement leurs cartes et les filtres gardent les boutons membres', async () => {
  const { plugin, rendu } = charger({ ...ETAT_TEST }); await plugin.onload();
  const premiere = { rev: 1, auteurId: 'm1', auteur: 'Membre test', chemin: 'note.md', le: 1700000000000 };
  let changements = [premiere];
  plugin.moteur.api = async (_, route) => ({ json: async () => ({ ...INFO_TEST, changements: route.includes('auteur=') ? [] : changements }) });
  await plugin.ruban.callback();
  const t = rendu.modal.tableau, carte = t.zone.children[0], membres = [...t.membresEl.children];
  changements = [{ ...premiere, rev: 2, chemin: 'autre.md' }, premiere];
  await t.charger();
  assert.equal(t.zone.children.length, 2);
  assert.equal(t.zone.children[1], carte);
  assert.deepEqual(t.membresEl.children, membres);
  assert.equal(t.comptes.get('m1'), 2);
  await rendu.boutons.get('Voir les changements de Membre test')();
  assert.deepEqual(t.membresEl.children, membres, 'le bouton utilisé pour filtrer reste en place');
  assert.equal(membres[1].getAttribute('aria-pressed'), 'true');
  assert.equal(t.zone.children[0].textContent, 'Aucun changement récent pour ce membre.');
  await rendu.boutons.get('Tous')();
  assert.equal(t.zone.children.length, 2);
  assert.equal(membres[0].getAttribute('aria-pressed'), 'true');
  changements = [premiere]; await t.charger();
  assert.equal(t.zone.children.length, 1);
  assert.equal(t.zone.children[0].getAttribute('data-revision'), '1');
});

test('changer de note met la présence à jour sans recharger l’activité', async () => {
  const { plugin, rendu } = charger({ ...ETAT_TEST }); await plugin.onload();
  plugin.presence = [{ id: 'm1', nom: 'Membre test', chemin: 'avant.md' }];
  let appels = 0;
  // Le stockage et la discussion ont leur propre lecture : seule l'activité compte ici.
  plugin.moteur.api = async (methode, chemin) => { if (String(chemin).includes('/activite')) appels++; return { json: async () => ({ ...INFO_TEST, changements: [] }) }; };
  await plugin.ruban.callback();
  const t = rendu.modal.tableau, membres = [...t.membresEl.children];
  plugin.presence = [{ id: 'm1', nom: 'Membre test', chemin: 'apres.md' }];
  plugin.afficher(); await new Promise(setImmediate);
  assert.equal(appels, 1);
  assert.deepEqual(t.membresEl.children, membres);
  assert.equal(t.lignesPresence[0].statut.textContent, 'en ligne · sur apres.md');
});

test('une erreur d’actualisation laisse l’activité consultable puis permet de réessayer', async () => {
  const { plugin, rendu } = charger({ ...ETAT_TEST }); await plugin.onload();
  const info = { ...INFO_TEST, changements: [{ rev: 1, auteurId: 'm1', auteur: 'Membre test', chemin: 'note.md', le: 1700000000000 }] };
  plugin.moteur.api = async () => ({ json: async () => info });
  await plugin.ruban.callback();
  const t = rendu.modal.tableau, carte = t.zone.children[0];
  plugin.moteur.api = async () => { throw Error('hors ligne'); };
  await t.charger();
  assert.equal(t.zone.children[0], carte);
  assert.match(t.information.textContent, /Actualisation impossible/);
  plugin.moteur.api = async () => ({ json: async () => info });
  await t.charger();
  assert.equal(t.zone.children[0], carte);
  assert.match(t.information.textContent, /40 changements maximum/);
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

async function bancDiscussion(messages = [], navigateur = {}) {
  const banc = charger({ ...ETAT_TEST, prenom: 'Alice' }, navigateur);
  await banc.plugin.onload();
  const appels = [], stock = [...messages];
  const api = async (methode, route, corps) => {
    appels.push({ methode, route, corps });
    if (route.includes('/messages')) {
      if (methode === 'POST') {
        const message = { id: (stock.at(-1)?.id || 0) + 1, auteurId: 'alice', auteur: 'Alice', texte: corps.texte, le: Date.now() };
        stock.push(message); return { json: async () => message };
      }
      const depuis = new URL(route, 'https://cordee.example').searchParams.get('depuis');
      const liste = depuis === null ? stock.slice(-50) : stock.filter(m => m.id > Number(depuis));
      return { json: async () => ({ messages: liste.slice(0, 50), moiId: 'alice', plus: liste.length > 50 }) };
    }
    return { json: async () => ({ rev: 0, moiId: 'alice', changements: [], membres: [{ id: 'alice', nom: 'Alice' }, { id: 'bruno', nom: 'Bruno' }] }) };
  };
  banc.plugin.moteur.api = api;
  return { ...banc, appels, stock, api };
}

test('discussion : bulles sûres, envoi par Entrée, Maj+Entrée et commande dédiée', async () => {
  const { plugin, rendu, appels } = await bancDiscussion([
    { id: 1, auteurId: 'alice', auteur: 'Alice', texte: '<img src=x onerror=alert(1)>', le: 1700000000000 },
    { id: 2, auteurId: 'bruno', auteur: 'Bruno', texte: 'Bonjour Alice\nÀ demain !', le: 1700000001000 },
  ]);
  await rendu.commandes.get('discussion').callback();
  const t = rendu.modal.tableau;
  assert.equal(t.discussion.titre.textContent, 'Discussion');
  assert.equal(t.discussion.corps.parentElement.tag, 'details');
  assert.equal(rendu.focus, t.saisieDiscussion);
  assert.equal(t.messagesEl.children[0].attrs.cls, 'cordee-message cordee-message-moi');
  assert.equal(t.messagesEl.children[1].attrs.cls, 'cordee-message');
  assert.match(t.messagesEl.children[1].children[0].textContent, /^Bruno · \d{2}:\d{2}$/);
  assert.equal(t.messagesEl.children[0].children[1].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(t.messagesEl.children[1].children[1].textContent, 'Bonjour Alice\nÀ demain !');
  assert.equal(t.messagesEl.querySelector('img'), null);
  assert.equal(t.messagesEl.scrollTop, t.messagesEl.scrollHeight);
  assert.deepEqual(rendu.notices, []);
  t.saisieDiscussion.value = '  Salut Bruno\nÀ bientôt  ';
  let empeche = 0;
  await t.saisieDiscussion.onkeydown({ key: 'Enter', shiftKey: true, preventDefault() { empeche++; } });
  await t.saisieDiscussion.onkeydown({ key: 'Enter', isComposing: true, preventDefault() { empeche++; } });
  assert.equal(appels.filter(a => a.methode === 'POST').length, 0);
  await t.saisieDiscussion.onkeydown({ key: 'Enter', preventDefault() { empeche++; } });
  assert.equal(empeche, 1);
  assert.equal(appels.find(a => a.methode === 'POST').corps.texte, 'Salut Bruno\nÀ bientôt');
  assert.equal(t.saisieDiscussion.value, '');
  assert.equal(t.messagesEl.children.length, 3);
  assert.equal(t.messagesEl.scrollTop, t.messagesEl.scrollHeight);
  t.discussion.corps.parentElement.open = false;
  plugin.ouvrirPanneau = async () => {};
  await rendu.commandes.get('discussion').callback();
  assert.equal(t.discussion.corps.parentElement.open, true);
  assert.equal(rendu.focus, t.saisieDiscussion);
});

test('discussion : validation locale et refus serveur gardent le brouillon', async () => {
  const { plugin, rendu, appels, api } = await bancDiscussion();
  await plugin.ruban.callback(); const t = rendu.modal.tableau;
  for (const texte of [' \n ', 'x'.repeat(2001)]) {
    t.saisieDiscussion.value = texte; await t.envoyerMessage();
    assert.equal(t.saisieDiscussion.value, texte);
    assert.equal(t.etatDiscussion.textContent, 'Écris entre 1 et 2000 caractères.');
  }
  assert.equal(appels.filter(a => a.methode === 'POST').length, 0);
  plugin.moteur.api = async (methode, ...args) => {
    if (methode !== 'POST') return api(methode, ...args);
    const erreur = new Error('Trop de messages, réessaie dans une minute.'); erreur.statut = 429; throw erreur;
  };
  t.saisieDiscussion.value = 'Bonjour Bruno'; await t.envoyerMessage();
  assert.equal(t.saisieDiscussion.value, 'Bonjour Bruno');
  assert.match(t.etatDiscussion.textContent, /Trop de messages/);
  assert.equal(t.envoyerDiscussion.disabled, false);
  plugin.moteur.api = api; await t.envoyerMessage();
  assert.equal(t.saisieDiscussion.value, '');
});

test('discussion : le sondage rattrape toutes les pages sans doublons ni effacer la saisie', async () => {
  const { plugin, rendu, stock, appels } = await bancDiscussion();
  await plugin.ruban.callback(); const t = rendu.modal.tableau;
  t.saisieDiscussion.value = 'Brouillon pour Bruno';
  for (let id = 1; id <= 105; id++) stock.push({ id, auteurId: 'bruno', auteur: 'Bruno', texte: 'Message ' + id, le: Date.now() });
  plugin.ecouter(); await plugin.intervalle();
  assert.equal(plugin.discussion.dernier, 105);
  assert.equal(t.messagesEl.children.length, 50);
  assert.equal(t.messagesEl.children[0].children[1].textContent, 'Message 56');
  assert.equal(t.messagesEl.children.at(-1).children[1].textContent, 'Message 105');
  assert.equal(t.saisieDiscussion.value, 'Brouillon pour Bruno');
  assert.equal(t.messagesEl.scrollTop, t.messagesEl.scrollHeight);
  assert.deepEqual(rendu.notices, [], 'le panneau visible suffit');
  assert.ok(appels.some(a => a.route.endsWith('&depuis=50')));
  assert.ok(appels.some(a => a.route.endsWith('&depuis=100')));
  const bulles = [...t.messagesEl.children];
  await plugin.intervalle();
  assert.deepEqual(t.messagesEl.children, bulles, 'un sondage vide ne reconstruit pas les bulles');
});

test('discussion : le flux reçoit les messages et prévient seulement pour un ami hors du panneau', async () => {
  let controle;
  const { plugin, rendu, stock } = await bancDiscussion([
    { id: 1, auteurId: 'bruno', auteur: 'Bruno', texte: 'Ancien message', le: Date.now() },
  ], {
    AbortController, setTimeout,
    fetch: async (_, options) => new Response(new ReadableStream({ start(c) {
      controle = c; options.signal.addEventListener('abort', () => c.error(Error('arrêt')));
    } }), { headers: { 'Content-Type': 'text/event-stream' } }),
  });
  const synchros = []; plugin.programmer = ms => synchros.push(ms);
  plugin.maintenirFlux(); await new Promise(setImmediate);
  assert.equal(plugin.discussion.dernier, 1); assert.deepEqual(rendu.notices, []);
  const envoyer = id => controle.enqueue(new TextEncoder().encode(`data: {"message":${id}}\n\n`));
  stock.push({ id: 2, auteurId: 'bruno', auteur: 'Bruno', texte: 'Bonjour Alice\n' + 'x'.repeat(100), le: Date.now() });
  envoyer(2); await new Promise(setImmediate);
  assert.equal(plugin.discussion.dernier, 2);
  assert.match(rendu.notice, /^Bruno : Bonjour Alice x+…$/);
  assert.ok(rendu.notice.length < 100);
  envoyer(2); await new Promise(setImmediate); assert.equal(rendu.notices.length, 1);
  stock.push({ id: 3, auteurId: 'alice', auteur: 'Alice', texte: 'Mon message', le: Date.now() });
  envoyer(3); await new Promise(setImmediate); assert.equal(rendu.notices.length, 1);
  await plugin.ruban.callback(); const t = rendu.modal.tableau;
  stock.push({ id: 4, auteurId: 'bruno', auteur: 'Bruno', texte: 'Panneau visible', le: Date.now() });
  envoyer(4); await new Promise(setImmediate); assert.equal(rendu.notices.length, 1);
  assert.equal(t.messagesEl.children.length, 4);
  t.c.isShown = () => false;
  stock.push({ id: 5, auteurId: 'bruno', auteur: 'Bruno', texte: 'Panneau masqué', le: Date.now() });
  envoyer(5); await new Promise(setImmediate); assert.equal(rendu.notice, 'Bruno : Panneau masqué');
  assert.deepEqual(synchros, [], 'le chat ne programme aucune synchro de fichiers');
  const flux = plugin.fluxRevisions; plugin.onunload(); await flux.termine;
});

test('discussion : les anciens serveurs restent utilisables après un 404 en lecture ou envoi', async () => {
  for (const methode404 of ['GET', 'POST']) {
    const { plugin, rendu, api } = await bancDiscussion();
    let tentatives = 0;
    plugin.moteur.api = async (methode, route, corps) => {
      if (route.includes('/messages') && methode === methode404) { tentatives++; const erreur = new Error('Route inconnue'); erreur.statut = 404; throw erreur; }
      return api(methode, route, corps);
    };
    await plugin.ruban.callback(); const t = rendu.modal.tableau;
    if (methode404 === 'POST') { t.saisieDiscussion.value = 'Bonjour Bruno'; await t.envoyerMessage(); }
    assert.equal(t.etatDiscussion.textContent, 'Mets le serveur à jour pour discuter');
    assert.equal(t.formulaireDiscussion.hidden, true);
    assert.ok(rendu.boutons.has('Synchroniser'));
    await plugin.rafraichirDiscussion(); assert.equal(tentatives, 1);
    assert.equal(plugin.phase, 'pret');
  }
});

test('discussion : un événement pendant la lecture est rattrapé, une réponse ancienne reste dans son coffre', async () => {
  const { plugin, rendu, api, stock } = await bancDiscussion();
  await plugin.ruban.callback(); const t = rendu.modal.tableau;
  const attente = Promise.withResolvers();
  plugin.moteur.api = async (methode, route, corps) => route.includes('/messages') ? attente.promise : api(methode, route, corps);
  const chargement = plugin.rafraichirDiscussion();
  stock.push({ id: 1, auteurId: 'bruno', auteur: 'Bruno', texte: 'Arrivé pendant la lecture', le: Date.now() });
  assert.equal(plugin.rafraichirDiscussion(1), chargement);
  plugin.moteur.api = api;
  attente.resolve({ json: async () => ({ messages: [], moiId: 'alice' }) }); await chargement;
  assert.equal(plugin.discussion.dernier, 1, 'un événement reçu pendant une réponse vide relance la lecture');
  const retard = Promise.withResolvers();
  plugin.moteur.api = () => retard.promise;
  const ancien = plugin.rafraichirDiscussion();
  plugin.etat.coffreId = 'autre';
  retard.resolve({ json: async () => ({ messages: [{ id: 2, auteurId: 'bruno', auteur: 'Bruno', texte: 'Ne pas afficher', le: Date.now() }], moiId: 'alice' }) });
  await ancien;
  assert.equal(plugin.discussion.messages.length, 0);
  assert.equal(rendu.textes.includes('Ne pas afficher'), false);
  assert.deepEqual(rendu.notices, []);
  t.detruire(); assert.equal(plugin.tableauxDiscussion.size, 0);
});

test('discussion : un envoi en cours garde les nouvelles frappes et ne part qu’une fois', async () => {
  const { plugin, rendu, api } = await bancDiscussion();
  await plugin.ruban.callback(); const t = rendu.modal.tableau;
  const attente = Promise.withResolvers(); let envois = 0;
  plugin.moteur.api = async (methode, route, corps) => {
    if (methode !== 'POST') return api(methode, route, corps);
    envois++; await attente.promise; return api(methode, route, corps);
  };
  t.saisieDiscussion.value = 'Premier'; const envoi = t.envoyerMessage();
  await t.envoyerMessage(); assert.equal(envois, 1);
  t.saisieDiscussion.value = 'Message suivant';
  attente.resolve(); await envoi;
  assert.equal(t.saisieDiscussion.value, 'Message suivant');
  assert.equal(t.messagesEl.children[0].children[1].textContent, 'Premier');
});

test('discussion : le lecteur SSE distingue messages, révisions et données invalides', async () => {
  const { interne } = charger({}, { AbortController, setTimeout });
  const morceaux = ['data: {"mes', 'sage":4}\r\n\r\ndata: {"rev":2}\n\n',
    'data: null\n\ndata: faux\n\ndata: {"message":0}\n\ndata: {"message":"5"}\n\ndata: {"message":-1}\n\n'];
  const lire = async (recevoir, recevoirMessage) => interne.ecouterRevisions({
    url: 'https://cordee.example/api/coffres/test/evenements', jeton: 'jeton-fictif', signal: new AbortController().signal,
    recevoir, recevoirMessage,
    requete: async () => new Response(new ReadableStream({ start(c) {
      for (const morceau of morceaux) c.enqueue(new TextEncoder().encode(morceau)); c.close();
    } }), { headers: { 'Content-Type': 'text/event-stream' } }),
  });
  const revisions = [], messages = [];
  await lire(rev => revisions.push(rev), id => messages.push(id));
  assert.deepEqual(revisions, [2]); assert.deepEqual(messages, [4]);
  const anciennesRevisions = []; await lire(rev => anciennesRevisions.push(rev));
  assert.deepEqual(anciennesRevisions, [2]);
});

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

test('la semaine : deux créneaux courts successifs ne se recouvrent pas', async () => {
  const { plugin, rendu, interne, obsidian } = charger({ ...ETAT_TEST });
  await plugin.onload();
  const debut = new Date(2026, 10, 12, 9).getTime();
  plugin.evenementsEntre = async () => [
    { titre: 'Point rapide', debut, fin: debut + 5 * 60_000, type: 'cordee' },
    { titre: 'Suite du projet', debut: debut + 10 * 60_000, fin: debut + 20 * 60_000, type: 'cordee' },
  ];
  await interne.dessinerSemaine(new obsidian.Modal(plugin.app).contentEl, plugin, interne.debutSemaine(debut), () => {});
  const cartes = rendu.elements.filter((e) => e.attrs.cls?.split(/\s+/).includes('cordee-evenement'));
  assert.equal(cartes.length, 2);
  const basPremiere = parseFloat(cartes[0].style.top) + parseFloat(cartes[0].style.height);
  assert.ok(basPremiere <= parseFloat(cartes[1].style.top), 'la hauteur minimale ne doit pas masquer le créneau suivant');
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

test('Moodle : une adresse de connexion obtient un jeton et efface le mot de passe sans le sauvegarder', async () => {
  const { plugin, rendu, obsidian } = charger({});
  const appels = [];
  obsidian.requestUrl = async (r) => {
    appels.push(r);
    const param = new URLSearchParams(r.body);
    if (r.url.endsWith('/login/token.php')) {
      assert.equal(r.url, 'https://moodle.exemple.fr/campus/login/token.php');
      assert.equal(param.get('service'), 'moodle_mobile_app');
      assert.equal(param.get('username'), 'agent-local');
      assert.equal(param.get('password'), 'mot-de-passe-factice');
      return { status: 200, json: { token: 'jeton-moodle-factice' } };
    }
    assert.equal(r.url, 'https://moodle.exemple.fr/campus/webservice/rest/server.php');
    assert.equal(param.get('wstoken'), 'jeton-moodle-factice');
    return { status: 200, json: param.get('wsfunction') === 'core_webservice_get_site_info' ? { userid: 42, firstname: 'Étudiant test' } : [{ id: 3, shortname: 'ENER3' }] };
  };
  await plugin.onload(); plugin.onglet.display();
  assert.ok(rendu.textes.includes('Moodle'));
  const champ = (nom) => rendu.champs.find((c) => c.nom === nom).champ;
  champ('Adresse du site Moodle').change('https://moodle.exemple.fr/campus/login/index.php');
  champ('Identifiant Moodle').change('agent-local');
  const passe = champ('Mot de passe Moodle'); passe.inputEl.value = 'mot-de-passe-factice';
  await rendu.boutons.get('Tester')();
  assert.equal(passe.inputEl.value, '');
  assert.ok(rendu.textes.includes('Connecté en tant que Étudiant test · 1 cours'));
  assert.equal(rendu.sauvegarde.moodle.jeton, 'jeton-moodle-factice');
  assert.equal(rendu.sauvegarde.moodle.site, 'https://moodle.exemple.fr/campus');
  assert.equal(appels.length, 3);
  assert.ok(appels.every((r) => r.method === 'POST' && !r.url.includes('jeton-moodle-factice')));
  assert.doesNotMatch(JSON.stringify(rendu.sauvegarde), /mot-de-passe-factice|password|username/);
  plugin.onglet.display();
  assert.equal(champ('Jeton Moodle').inputEl.type, 'password');
  assert.equal(champ('Jeton Moodle').inputEl.value || '', '');
  assert.doesNotMatch(rendu.textes.join(' '), /jeton-moodle-factice/);
  await rendu.boutons.get('Se déconnecter de Moodle')();
  assert.equal(rendu.sauvegarde.moodle.jeton, '');
});

test('Moodle : un jeton collé est masqué, enregistré, puis réutilisé par Tester', async () => {
  const { plugin, rendu, obsidian } = charger({});
  let connexions = 0;
  obsidian.requestUrl = async (r) => {
    assert.ok(!r.url.includes('token.php'));
    const param = new URLSearchParams(r.body);
    assert.equal(param.get('wstoken'), 'jeton-copie-factice');
    connexions++;
    return { status: 200, json: param.get('wsfunction') === 'core_webservice_get_site_info' ? { userid: 42, firstname: 'Étudiant test' } : [] };
  };
  await plugin.onload(); plugin.onglet.display();
  rendu.champs.find((c) => c.nom === 'Adresse du site Moodle').champ.change('https://moodle.exemple.fr');
  const jeton = rendu.champs.find((c) => c.nom === 'Jeton Moodle').champ;
  jeton.inputEl.value = 'jeton-copie-factice';
  await rendu.boutons.get('Tester')();
  assert.equal(jeton.inputEl.value, '');
  assert.equal(plugin.etat.moodle.jeton, 'jeton-copie-factice');
  await rendu.boutons.get('Tester')();
  assert.equal(connexions, 4);
});

test('Moodle : connexion universitaire avec retour collé, sans mot de passe ni clé privée sauvegardés', async () => {
  const { plugin, rendu, obsidian } = charger({}, { crypto: webcrypto });
  const token = 'b'.repeat(32), prive = 'Ab9z'.repeat(16);
  const appels = [];
  obsidian.requestUrl = async (r) => {
    appels.push(r);
    assert.equal(r.url, 'https://moodle.exemple.fr/webservice/rest/server.php');
    const param = new URLSearchParams(r.body);
    assert.equal(param.get('wstoken'), token);
    assert.equal(param.has('password'), false);
    return { status: 200, json: param.get('wsfunction') === 'core_webservice_get_site_info' ? { userid: 42, firstname: 'Étudiant test' } : [] };
  };
  await plugin.onload(); plugin.onglet.display();
  rendu.champs.find((c) => c.nom === 'Adresse du site Moodle').champ.change('https://moodle.exemple.fr/login/index.php');
  rendu.boutons.get('Se connecter via le navigateur')();
  const ancre = rendu.elements.find((e) => e.tag === 'a' && e.textContent === 'Ouvrir la connexion Moodle');
  assert.equal(new URL(ancre.attrs.attr.href).searchParams.get('urlscheme'), 'cordee-moodle');
  const champ = rendu.champs.find((c) => c.nom === 'Lien de retour Moodle').champ;
  assert.equal(champ.inputEl.type, 'password');
  const lien = 'moodlemobile://token=' + Buffer.from('a'.repeat(32) + ':::' + token + ':::' + prive).toString('base64');
  champ.inputEl.value = lien;
  await rendu.boutons.get('Terminer la connexion')();
  assert.equal(appels.length, 2);
  assert.equal(plugin.etat.moodle.jeton, token);
  assert.equal(champ.inputEl.value, '');
  assert.doesNotMatch(JSON.stringify(rendu.sauvegarde), new RegExp(prive + '|passport|cordee-moodle://'));
  assert.ok(rendu.textes.includes('Connecté en tant que Étudiant test · 0 cours'));
  // Une erreur de copie est locale : aucun lien étranger n’est visité.
  champ.inputEl.value = 'https://autre.exemple.fr/?token=secret';
  await rendu.boutons.get('Terminer la connexion')();
  assert.equal(appels.length, 2);
  assert.equal(champ.inputEl.value, '');
});

test('Moodle : les erreurs sont simples et ne reprennent aucun secret de la réponse réseau', async () => {
  const { plugin, obsidian } = charger({});
  await plugin.onload();
  obsidian.requestUrl = async () => ({ status: 200, json: { error: 'jeton-secret-dans-erreur', errorcode: 'invalidlogin' } });
  await assert.rejects(plugin.connecterMoodle('https://moodle.exemple.fr', '', 'agent-local', 'factice'), /connexion de l’université.*Préférences → Clés de sécurité/);
  obsidian.requestUrl = async () => ({ status: 200, json: { exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'jeton-secret-dans-erreur' } });
  await assert.rejects(plugin.connecterMoodle('https://moodle.exemple.fr', 'factice'), (e) => /invalide ou expiré/.test(e.message) && !e.message.includes('jeton-secret-dans-erreur'));
  obsidian.requestUrl = async () => { throw new Error('https://exemple.fr?token=jeton-secret-dans-erreur'); };
  await assert.rejects(plugin.connecterMoodle('https://moodle.exemple.fr', 'factice'), (e) => /injoignable/.test(e.message) && !e.message.includes('jeton-secret-dans-erreur'));
});

test('Moodle : distingue un jeton rejeté, un accès refusé et un service indisponible sans exposer les secrets', async () => {
  const { plugin, obsidian } = charger({});
  await plugin.onload();
  const cas = [
    ['invalidtoken', /invalide ou expiré.*invalidtoken/],
    ['invalidtimedtoken', /expiré.*invalidtimedtoken/],
    ['invalidiptoken', /connexion réseau.*invalidiptoken/],
    ['accessexception', /refuse l’accès.*accessexception/],
    ['webservice_access_exception', /refuse l’accès.*webservice_access_exception/],
    ['servicenotavailable', /indisponible ou désactivé/],
    ['requireloginerror', /exige une connexion/],
    ['jeton-secret-dans-erreur', /Moodle refuse cette demande/],
  ];
  for (const [code, attendu] of cas) {
    obsidian.requestUrl = async () => ({ status: 200, json: { exception: 'moodle_exception', errorcode: code, message: 'jeton-secret-dans-erreur' } });
    await assert.rejects(plugin.connecterMoodle('https://moodle.exemple.fr', 'factice'), (e) => {
      assert.match(e.message, attendu);
      assert.doesNotMatch(e.message, /jeton-secret-dans-erreur/);
      if (code !== 'invalidtoken') assert.doesNotMatch(e.message, /Ton jeton Moodle est invalide/);
      return true;
    });
  }
  for (const status of [401, 403]) {
    obsidian.requestUrl = async () => ({ status, get json() { throw new Error('jeton-secret-dans-erreur'); } });
    await assert.rejects(plugin.connecterMoodle('https://moodle.exemple.fr', 'factice'), (e) => {
      assert.match(e.message, new RegExp('HTTP ' + status));
      assert.doesNotMatch(e.message, /Ton jeton Moodle est invalide|jeton-secret-dans-erreur/);
      return true;
    });
  }
});

async function moodleSimule(navigateur = {}) {
  const acces = { site: 'https://moodle.exemple.fr', jeton: 'jeton-import-factice', userid: 42, selections: { 3: { copier: true, dossier: 'Moodle/ENER3' } } };
  const charge = charger({ moodle: acces }, { crypto: webcrypto, ...navigateur });
  const { plugin, obsidian } = charge, elements = new Map(), appels = [];
  let horloge = 0;
  const mettre = (chemin, texte) => {
    const f = Object.assign(new obsidian.TFile(), { path: chemin, contenu: new TextEncoder().encode(texte).buffer, stat: { mtime: ++horloge } });
    elements.set(chemin, f); return f;
  };
  Object.assign(plugin.app.vault, {
    getAbstractFileByPath: (p) => elements.get(p), getAllLoadedFiles: () => [...elements.values()], getFiles: () => [...elements.values()].filter((f) => f instanceof obsidian.TFile),
    readBinary: async (f) => f.contenu, adapter: { exists: async (p) => elements.has(p) },
    createFolder: async (p) => { elements.set(p, Object.assign(new obsidian.TFolder(), { path: p })); },
    createBinary: async (p, contenu) => { assert.equal(elements.has(p), false, 'aucun fichier existant écrasé à la création'); const f = mettre(p, ''); f.contenu = contenu; return f; },
    modifyBinary: async (f, contenu) => { f.contenu = contenu; f.stat.mtime = ++horloge; },
  });
  const source = { type: 'file', filename: 'cours.pdf', filepath: '/', fileurl: 'https://moodle.exemple.fr/webservice/pluginfile.php/12/cours.pdf?forcedownload=1', filesize: 7, timemodified: 1 };
  let texte = 'cours 1';
  obsidian.requestUrl = async (r) => {
    appels.push(r);
    if (!r.body) return { status: 200, arrayBuffer: new TextEncoder().encode(texte).buffer, headers: { 'content-type': 'application/pdf' } };
    const param = new URLSearchParams(r.body);
    if (param.get('wsfunction') === 'core_enrol_get_users_courses') return { status: 200, json: [{ id: 3, shortname: 'ENER3', fullname: 'Énergie 3' }] };
    if (param.get('wsfunction') === 'mod_assign_get_assignments') return { status: 200, json: { courses: [] } };
    if (param.get('wsfunction') === 'mod_forum_get_forums_by_courses') return { status: 200, json: [] };
    assert.equal(param.get('wsfunction'), 'core_course_get_contents');
    return { status: 200, json: [{ id: 1, name: 'Cours', modules: [{ id: 12, modname: 'resource', contents: [source] }] }] };
  };
  await plugin.onload();
  return { ...charge, elements, appels, source, mettre, texte: (p) => new TextDecoder().decode(elements.get(p).contenu), changer: (v) => { texte = v; source.timemodified++; } };
}

test('Moodle : la fenêtre choisit le partage et une destination par cours', async () => {
  const { plugin, rendu, interne } = await moodleSimule();
  plugin.etat.moodle.selections = {};
  await new interne.CoursMoodleModal(plugin.app, plugin).open();
  assert.ok(rendu.textes.some((t) => /partagé avec la cordée/.test(t)));
  const selection = rendu.elements.find((e) => e.attrs.attr?.['aria-label'] === 'Copier dans le coffre : ENER3');
  assert.equal(selection.checked, false);
  selection.checked = true; await selection.onchange();
  assert.equal(rendu.sauvegarde.moodle.selections[3].copier, true);
  const dossier = rendu.champs.find((c) => c.nom === 'Dossier de destination · ENER3').champ;
  assert.equal(dossier.value, 'Moodle/ENER3');
  await dossier.change('Mes cours/ENER3');
  assert.equal(rendu.sauvegarde.moodle.selections[3].dossier, 'Mes cours/ENER3');
  await dossier.change('../Configuration');
  assert.equal(plugin.etat.moodle.selections[3].dossier, 'Mes cours/ENER3');
  assert.ok(rendu.boutons.has('Récupérer maintenant'));
  await rendu.boutons.get('Récupérer maintenant')();
  assert.ok(rendu.textes.includes('Corrige le dossier de destination avant de récupérer les fichiers.'));
});

test('Moodle : import par le coffre, index, puis aucun téléchargement si rien ne change', async () => {
  const { plugin, rendu, appels, texte } = await moodleSimule();
  assert.equal(await plugin.recupererMoodle(), 1);
  assert.equal(texte('Moodle/ENER3/Cours/cours.pdf'), 'cours 1');
  assert.match(texte('Moodle/ENER3/Cours.md'), /\[\[Moodle\/ENER3\/Cours\/cours.pdf\|cours.pdf\]\]/);
  assert.equal(rendu.notice, '1 nouveau fichier dans ENER3');
  const fichier = appels.find((r) => !r.body);
  assert.equal(new URL(fichier.url).searchParams.get('token'), 'jeton-import-factice');
  assert.equal(new URL(fichier.url).searchParams.get('forcedownload'), '1');
  assert.equal(await plugin.recupererMoodle(), 0);
  assert.equal(appels.filter((r) => !r.body).length, 1);
  assert.doesNotMatch(texte('Moodle/ENER3/Cours.md'), /jeton-import-factice|https:/);
  assert.doesNotMatch(JSON.stringify(plugin.etat.moodle.fichiers), /jeton-import-factice|fileurl/);
});

test('Moodle : un fichier explicitement exclu ne revient pas après sa suppression locale', async () => {
  const { plugin, elements, appels, texte } = await moodleSimule();
  await plugin.recupererMoodle();
  const entree = Object.values(plugin.etat.moodle.fichiers)[0];
  entree.ignorer = true;
  elements.delete(entree.chemin);
  const avant = appels.filter((r) => !r.body).length;
  assert.equal(await plugin.recupererMoodle(), 0);
  assert.equal(appels.filter((r) => !r.body).length, avant);
  assert.equal(elements.has(entree.chemin), false);
  assert.doesNotMatch(texte('Moodle/ENER3/Cours.md'), /cours\.pdf/);
  assert.equal(entree.ignorer, true);
});

const PNG_COURS_FICTIF = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
const couvertureFictive = (autre = {}) => ({ filename: 'couverture.png', fileurl: 'https://moodle.exemple.fr/webservice/pluginfile.php/42/couverture.png', filesize: PNG_COURS_FICTIF.length, timemodified: 1, mimetype: 'image/png', ...autre });

test('Moodle : couverture copiée une fois, index illustré, copie locale préservée et aucun jeton dans le coffre', async () => {
  const { plugin, obsidian, texte, mettre, elements, interne, rendu } = await moodleSimule();
  const original = obsidian.requestUrl, couverture = couvertureFictive();
  let images = 0;
  obsidian.requestUrl = async (r) => {
    if (!r.body && new URL(r.url).pathname.endsWith('/couverture.png')) {
      images++;
      return { status: 200, arrayBuffer: PNG_COURS_FICTIF.buffer.slice(PNG_COURS_FICTIF.byteOffset, PNG_COURS_FICTIF.byteOffset + PNG_COURS_FICTIF.length), headers: { 'content-type': 'image/png' } };
    }
    const reponse = await original(r);
    if (r.body && new URLSearchParams(r.body).get('wsfunction') === 'core_enrol_get_users_courses') reponse.json[0].overviewfiles = [couverture];
    return reponse;
  };
  await plugin.recupererMoodle();
  assert.ok(elements.has('Moodle/ENER3/_Médias/Couverture.png'));
  assert.ok(texte('Moodle/ENER3/Cours.md').includes('![[Moodle/ENER3/_Médias/Couverture.png|640]]'));
  let ouvert;
  plugin.app.workspace.openLinkText = (chemin) => { ouvert = chemin; };
  const modal = new interne.CoursMoodleModal(plugin.app, plugin);
  await modal.open();
  await rendu.boutons.get('Ouvrir le cours')();
  assert.equal(ouvert, 'Moodle/ENER3/Cours.md');
  modal.onClose();
  assert.equal(images, 1, 'une couverture déjà présente est lue localement pour la carte');
  await plugin.recupererMoodle();
  assert.equal(images, 1);
  mettre('Moodle/ENER3/_Médias/Couverture.png', 'ma couverture');
  couverture.timemodified++;
  await plugin.recupererMoodle();
  assert.equal(texte('Moodle/ENER3/_Médias/Couverture.png'), 'ma couverture');
  assert.ok(texte('Moodle/ENER3/Cours.md').includes('![[Moodle/ENER3/_Médias/Couverture (Moodle).png|640]]'));
  assert.doesNotMatch(JSON.stringify(plugin.etat.moodle.fichiers), /fileurl|https:|jeton-import-factice/);
});

test('Moodle : une couverture externe ou un faux PNG ne bloque pas les ressources et ne reçoit aucun jeton', async () => {
  for (const externe of [true, false]) {
    const { plugin, obsidian, texte, elements, appels } = await moodleSimule();
    const original = obsidian.requestUrl;
    obsidian.requestUrl = async (r) => {
      const reponse = await original(r);
      if (r.body && new URLSearchParams(r.body).get('wsfunction') === 'core_enrol_get_users_courses') {
        reponse.json[0].overviewfiles = [couvertureFictive(externe ? { fileurl: 'https://autre.exemple.fr/couverture.png' } : {})];
      }
      return reponse; // Le faux PNG reçoit les octets du PDF fictif : signature invalide.
    };
    await plugin.recupererMoodle();
    assert.equal(texte('Moodle/ENER3/Cours/cours.pdf'), 'cours 1');
    assert.equal(elements.has('Moodle/ENER3/_Médias/Couverture.png'), false);
    assert.ok(plugin.etat.moodle.avertissements.some((s) => /couverture/.test(s)));
    assert.equal(appels.some((r) => r.url.includes('autre.exemple.fr')), false);
  }
});

test('Moodle : cartes illustrées, recherche sans accents et libération des images à la fermeture', async () => {
  const crees = [], liberes = [];
  class URLApercu extends URL {
    static createObjectURL(blob) { assert.equal(blob.type, 'image/png'); const url = 'blob:apercu-' + crees.length; crees.push(url); return url; }
    static revokeObjectURL(url) { liberes.push(url); }
  }
  const { plugin, obsidian, interne, rendu, elements } = await moodleSimule({ URL: URLApercu });
  const original = obsidian.requestUrl;
  let images = 0;
  obsidian.requestUrl = async (r) => {
    if (!r.body) {
      images++;
      return { status: 200, arrayBuffer: Uint8Array.from(PNG_COURS_FICTIF).buffer, headers: { 'content-type': 'image/png' } };
    }
    const reponse = await original(r);
    if (new URLSearchParams(r.body).get('wsfunction') === 'core_enrol_get_users_courses') {
      reponse.json[0].overviewfiles = [couvertureFictive()];
      reponse.json[0].summary = '<p>Circuits et conversion</p>';
      reponse.json.push({ id: 4, shortname: 'INFO3', fullname: 'Informatique' });
    }
    return reponse;
  };
  const modal = new interne.CoursMoodleModal(plugin.app, plugin);
  await modal.open();
  assert.equal(images, 1);
  const image = rendu.elements.find((e) => e.tag === 'img');
  assert.equal(image.attrs.attr.src, 'blob:apercu-0');
  assert.doesNotMatch(JSON.stringify(rendu.elements.map((e) => e.attrs)), /jeton-import-factice|token=/);
  const cartes = rendu.elements.filter((e) => e.attrs.cls === 'cordee-moodle-carte');
  assert.equal(cartes.length, 2);
  const recherche = rendu.champs.find((c) => c.nom === 'Rechercher un cours').champ;
  recherche.change('energie');
  assert.equal(cartes[0].hidden, false);
  assert.equal(cartes[1].hidden, true);
  assert.ok(rendu.textes.includes('1 cours · 1 sélectionné'));
  recherche.change('aucun résultat');
  assert.ok(cartes.every((c) => c.hidden));
  recherche.change('');
  assert.ok(cartes.every((c) => !c.hidden));
  assert.equal([...elements.keys()].some((p) => p.includes('Couverture')), false, 'les aperçus seuls n’écrivent rien dans le coffre');
  modal.onClose();
  assert.deepEqual(liberes, crees);
});

test('Moodle : fermer les cartes pendant un téléchargement ne crée pas d’image tardive', async () => {
  let images = 0, terminer, demarrer;
  class URLApercu extends URL { static createObjectURL() { images++; return 'blob:tardif'; } }
  const { plugin, obsidian, interne } = await moodleSimule({ URL: URLApercu });
  const original = obsidian.requestUrl;
  const commence = new Promise((resolve) => { demarrer = resolve; });
  obsidian.requestUrl = async (r) => {
    if (!r.body) { demarrer(); return new Promise((resolve) => { terminer = () => resolve({ status: 200, arrayBuffer: Uint8Array.from(PNG_COURS_FICTIF).buffer }); }); }
    const reponse = await original(r);
    if (new URLSearchParams(r.body).get('wsfunction') === 'core_enrol_get_users_courses') reponse.json[0].overviewfiles = [couvertureFictive()];
    return reponse;
  };
  const modal = new interne.CoursMoodleModal(plugin.app, plugin), ouverture = modal.open();
  await commence; modal.onClose(); terminer(); await ouverture;
  assert.equal(images, 0);
});

test('Moodle : mises à jour conservées à côté des fichiers locaux modifiés, y compris les copies', async () => {
  const { plugin, mettre, changer, texte } = await moodleSimule();
  await plugin.recupererMoodle();
  mettre('Moodle/ENER3/Cours/cours.pdf', 'mes annotations');
  changer('cours 2'); await plugin.recupererMoodle();
  assert.equal(texte('Moodle/ENER3/Cours/cours.pdf'), 'mes annotations');
  assert.equal(texte('Moodle/ENER3/Cours/cours (Moodle).pdf'), 'cours 2');
  assert.match(texte('Moodle/ENER3/Cours.md'), /cours \(Moodle\).pdf/);
  changer('cours 3'); await plugin.recupererMoodle();
  assert.equal(texte('Moodle/ENER3/Cours/cours (Moodle).pdf'), 'cours 3');
  mettre('Moodle/ENER3/Cours/cours (Moodle).pdf', 'autres annotations');
  changer('cours 4'); await plugin.recupererMoodle();
  assert.equal(texte('Moodle/ENER3/Cours/cours (Moodle).pdf'), 'autres annotations');
  assert.equal(texte('Moodle/ENER3/Cours/cours (Moodle 2).pdf'), 'cours 4');
});

test('Moodle : un fichier déjà présent et une note d’index modifiée sont préservés', async () => {
  const { plugin, mettre, changer, texte } = await moodleSimule();
  mettre('Moodle/ENER3/Cours/cours.pdf', 'version locale préexistante');
  await plugin.recupererMoodle();
  assert.equal(texte('Moodle/ENER3/Cours/cours.pdf'), 'version locale préexistante');
  assert.equal(texte('Moodle/ENER3/Cours/cours (Moodle).pdf'), 'cours 1');
  mettre('Moodle/ENER3/Cours.md', 'mon index annoté');
  changer('cours 2'); await plugin.recupererMoodle();
  assert.equal(texte('Moodle/ENER3/Cours.md'), 'mon index annoté');
  assert.match(texte('Moodle/ENER3/Cours (Moodle).md'), /^# Énergie 3/);
});

test('Moodle : les fichiers trop gros ne sont pas téléchargés et les URL externes ne reçoivent pas le jeton', async () => {
  const { plugin, source, appels, rendu, obsidian } = await moodleSimule();
  source.filesize = 50 * 1024 * 1024 + 1;
  assert.equal(await plugin.recupererMoodle(), 0);
  assert.equal(appels.filter((r) => !r.body).length, 0);
  assert.match(rendu.notice, /dépassent 50 Mo/);
  await assert.rejects(plugin.telechargerMoodle({ fileurl: 'https://autre.exemple.fr/cours.pdf' }, plugin.etat.moodle), /autre site/);
  assert.equal(appels.filter((r) => !r.body).length, 0);
  obsidian.requestUrl = async () => ({ status: 200, arrayBuffer: { byteLength: 50 * 1024 * 1024 + 1 } });
  await assert.rejects(plugin.telechargerMoodle(source, plugin.etat.moodle), /dépasse 50 Mo/);
});

test('Moodle : déconnexion pendant le téléchargement, aucun fichier importé après coup', async () => {
  const { plugin, obsidian, elements } = await moodleSimule();
  const requete = obsidian.requestUrl;
  let liberer, debut;
  const telechargement = new Promise((r) => { debut = r; });
  obsidian.requestUrl = async (r) => {
    if (r.body) return requete(r);
    debut(); return new Promise((r) => { liberer = () => r({ status: 200, arrayBuffer: new TextEncoder().encode('cours 1').buffer }); });
  };
  const recuperation = plugin.recupererMoodle();
  await telechargement; await plugin.deconnecterMoodle(); liberer();
  await assert.rejects(recuperation, /arrêtée/);
  assert.equal([...elements.values()].filter((f) => f instanceof obsidian.TFile).length, 0);
  assert.equal(plugin.etat.moodle.jeton, '');
});

test('Moodle : déconnexion pendant Tester, le jeton tardif n’est jamais sauvegardé', async () => {
  const { plugin, obsidian } = charger({});
  await plugin.onload();
  let liberer;
  obsidian.requestUrl = async (r) => {
    const fonction = new URLSearchParams(r.body).get('wsfunction');
    if (fonction === 'core_webservice_get_site_info') return new Promise((resolve) => { liberer = () => resolve({ status: 200, json: { userid: 42, firstname: 'Étudiant test' } }); });
    return { status: 200, json: [] };
  };
  const connexion = plugin.connecterMoodle('https://moodle.exemple.fr', 'jeton-tardif-factice');
  await plugin.deconnecterMoodle(); liberer();
  await assert.rejects(connexion, /arrêtée/);
  assert.equal(plugin.etat.moodle.jeton, '');
});

test('Moodle : les automatismes attendent 6 h et ne lancent rien après déconnexion', async () => {
  const { plugin } = await moodleSimule();
  let nombre = 0;
  plugin.recupererMoodle = async () => { nombre++; };
  plugin.etat.moodle.derniereRecuperation = Date.now();
  plugin.demarrerMoodle();
  assert.equal(nombre, 0);
  plugin.etat.moodle.derniereRecuperation = Date.now() - 6 * 3600_000 - 100;
  plugin.intervalle();
  assert.equal(nombre, 1);
  await plugin.deconnecterMoodle(); plugin.intervalle();
  assert.equal(nombre, 1);
});

test('Moodle : fichiers supprimés localement récupérés à nouveau et cours non sélectionnés ignorés', async () => {
  const { plugin, elements, appels } = await moodleSimule();
  plugin.etat.moodle.selections[3].copier = false;
  assert.equal(await plugin.recupererMoodle(), 0);
  assert.equal(appels.filter((r) => !r.body).length, 0);
  plugin.etat.moodle.selections[3].copier = true;
  await plugin.recupererMoodle();
  elements.delete('Moodle/ENER3/Cours/cours.pdf');
  assert.equal(await plugin.recupererMoodle(), 1);
  assert.equal(appels.filter((r) => !r.body).length, 2);
});

test('Moodle : les devoirs à venir se lisent sans réseau depuis un cache privé actualisé avec les fichiers', async () => {
  const { plugin, obsidian, texte } = await moodleSimule();
  const avant = obsidian.requestUrl, echeance = Math.floor(Date.now() / 1000) + 86400;
  let rendu = false, appels = 0;
  obsidian.requestUrl = async (r) => {
    const param = new URLSearchParams(r.body), fonction = param.get('wsfunction');
    if (fonction === 'mod_assign_get_assignments') {
      appels++; assert.equal(param.get('courseids[0]'), '3');
      return { status: 200, json: { courses: [{ id: 3, assignments: [{ id: 15, cmid: 44, name: 'Rendu TP', duedate: echeance }, { id: 16, cmid: 45, name: 'Ancien devoir', duedate: 1 }] }] } };
    }
    if (fonction === 'mod_assign_get_submission_status') {
      appels++; assert.equal(param.get('userid'), '42');
      return { status: 200, json: { lastattempt: { submission: { status: rendu ? 'submitted' : 'draft' } } } };
    }
    return avant(r);
  };
  await plugin.recupererMoodle();
  const appelsAvant = appels, devoirs = plugin.devoirsMoodle();
  assert.equal(devoirs.length, 1);
  assert.equal(devoirs[0].titre, 'Rendu TP');
  assert.equal(devoirs[0].cours, 'ENER3');
  assert.equal(devoirs[0].debut, echeance * 1000);
  assert.equal(devoirs[0].rendu, false);
  assert.equal(devoirs[0].url, 'https://moodle.exemple.fr/mod/assign/view.php?id=44');
  devoirs[0].titre = 'modification externe';
  assert.equal(plugin.devoirsMoodle()[0].titre, 'Rendu TP');
  assert.equal(appels, appelsAvant);
  assert.doesNotMatch(texte('Moodle/ENER3/Cours.md'), /Rendu TP|submitted|rendu/);
  rendu = true; await plugin.recupererMoodle();
  assert.equal(plugin.devoirsMoodle()[0].rendu, true);
  await plugin.deconnecterMoodle();
  assert.equal(plugin.devoirsMoodle().length, 0);
});

test('Moodle : les annonces news sont partagées sans HTML, avec protection des annotations locales', async () => {
  const { plugin, obsidian, texte, mettre } = await moodleSimule();
  const avant = obsidian.requestUrl;
  let titre = 'Annonce test';
  obsidian.requestUrl = async (r) => {
    const param = new URLSearchParams(r.body), fonction = param.get('wsfunction');
    if (fonction === 'mod_forum_get_forums_by_courses') return { status: 200, json: [{ id: 9, course: 3, type: 'news' }, { id: 10, course: 3, type: 'general' }] };
    if (fonction === 'mod_forum_get_forum_discussions') {
      assert.equal(param.get('forumid'), '9'); assert.equal(param.get('perpage'), '20'); assert.equal(param.get('sortorder'), '3');
      return { status: 200, json: { discussions: [{ id: 5, subject: titre, created: 1900000000, userfullname: 'Équipe test', message: '<p>Apporte ton <b>multimètre</b>.</p><script>interdit()</script>' }] } };
    }
    return avant(r);
  };
  await plugin.recupererMoodle();
  const note = texte('Moodle/ENER3/Annonces.md');
  assert.match(note, /Annonce test/); assert.match(note, /Équipe test/); assert.match(note, /Apporte ton multimètre/);
  assert.doesNotMatch(note, /<|>|script|interdit|jeton-import-factice/);
  mettre('Moodle/ENER3/Annonces.md', 'mes annotations');
  titre = 'Annonce suivante'; await plugin.recupererMoodle();
  assert.equal(texte('Moodle/ENER3/Annonces.md'), 'mes annotations');
  assert.match(texte('Moodle/ENER3/Annonces (Moodle).md'), /Annonce suivante/);
});

test('Moodle : une API de devoirs indisponible préserve son cache et laisse récupérer les cours', async () => {
  const { plugin, obsidian, texte, rendu } = await moodleSimule();
  const avant = obsidian.requestUrl;
  plugin.etat.moodle.devoirs = [{ titre: 'Dernier état connu', cours: 'ENER3', debut: Date.now() + 86400000, rendu: false, url: 'https://moodle.exemple.fr/mod/assign/view.php?id=1' }];
  obsidian.requestUrl = async (r) => new URLSearchParams(r.body).get('wsfunction') === 'mod_assign_get_assignments'
    ? { status: 200, json: { exception: 'webservice_access_exception', errorcode: 'invalidfunction', message: 'erreur-technique-factice' } } : avant(r);
  assert.equal(await plugin.recupererMoodle(), 1);
  assert.equal(texte('Moodle/ENER3/Cours/cours.pdf'), 'cours 1');
  assert.equal(plugin.devoirsMoodle()[0].titre, 'Dernier état connu');
  assert.match(rendu.notice, /devoirs n’ont pas pu être actualisés/);
  assert.doesNotMatch(rendu.notice, /erreur-technique-factice/);
});

test('Moodle : les notes personnelles ne sont ni écrites dans le coffre ni sauvegardées', async () => {
  const { plugin, obsidian, interne, rendu, elements } = await moodleSimule();
  const avant = obsidian.requestUrl;
  let sauvegardes = 0; plugin.saveData = async () => { sauvegardes++; };
  obsidian.requestUrl = async (r) => {
    const param = new URLSearchParams(r.body);
    if (param.get('wsfunction') !== 'gradereport_user_get_grade_items') return avant(r);
    assert.equal(param.get('userid'), '42'); assert.equal(param.get('courseid'), '3');
    return { status: 200, json: { usergrades: [
      { userid: 42, gradeitems: [{ itemname: '<b>Évaluation privée</b>', gradeformatted: '<span>17,25</span>', rangeformatted: '0–20' }, { itemname: 'Note cachée', itemhidden: true, gradeformatted: '19' }] },
      { userid: 43, gradeitems: [{ itemname: 'Note d’un autre étudiant', gradeformatted: '12' }] },
    ] } };
  };
  const modal = new interne.NotesMoodleModal(plugin.app, plugin);
  await modal.open();
  assert.ok(rendu.textes.includes('Mes notes Moodle'));
  assert.ok(rendu.textes.includes('Évaluation privée · 17,25 · 0–20'));
  assert.equal(rendu.textes.some((t) => /Note cachée|autre étudiant/.test(t)), false);
  assert.equal(sauvegardes, 0); assert.equal(elements.size, 0);
  assert.doesNotMatch(JSON.stringify(plugin.etat), /17,25|Évaluation privée|gradeitems/);
  await plugin.deconnecterMoodle();
  assert.equal(modal.contentEl.enfants.length, 0);
  assert.equal(plugin.modalNotesMoodle, null);
});

test('Moodle : fermer les notes pendant leur lecture ignore la réponse tardive', async () => {
  const { plugin, obsidian, interne, rendu, elements } = await moodleSimule();
  const avant = obsidian.requestUrl;
  let debut, liberer;
  const requete = new Promise((r) => { debut = r; });
  obsidian.requestUrl = async (r) => {
    if (new URLSearchParams(r.body).get('wsfunction') !== 'gradereport_user_get_grade_items') return avant(r);
    debut(); return new Promise((resolve) => { liberer = () => resolve({ status: 200, json: { usergrades: [{ userid: 42, gradeitems: [{ itemname: 'Note tardive privée', gradeformatted: '16' }] }] } }); });
  };
  const modal = new interne.NotesMoodleModal(plugin.app, plugin), ouverture = modal.open();
  await requete; modal.onClose(); liberer(); await ouverture;
  assert.equal(rendu.textes.some((t) => String(t).includes('Note tardive privée')), false);
  assert.equal(elements.size, 0);
});

test('devoirs Moodle dans la semaine : état rendu ou à rendre, sans doublon avec le lien iCal', async () => {
  const { plugin } = charger({ ...ETAT_TEST });
  await plugin.onload();
  const limite = new Date(2026, 10, 13, 23, 59).getTime();
  plugin.etat.calendriers = [{ id: 'm', nom: 'Moodle', url: LIEN_MOODLE, type: 'moodle' }];
  plugin.etat.cacheCalendriers = { m: { maj: Date.now(), evenements: [{ titre: 'Rendu TP2 est dû', debut: limite, fin: limite }] } };
  plugin.devoirsMoodle = () => [{ titre: 'Rendu TP2', cours: 'ENER3', debut: limite, rendu: true, url: 'https://moodle.exemple.fr/mod/assign/view.php?id=1' }];
  const evts = await plugin.evenementsEntre(new Date(2026, 10, 9).getTime(), new Date(2026, 10, 16).getTime());
  assert.equal(evts.length, 1, 'le devoir n’apparaît qu’une fois');
  assert.equal(evts[0].rendu, true);
  assert.equal(evts[0].source, 'Moodle · ENER3');
});

test('les vidéos restent sur l’appareil sauf si « Partager les vidéos » est activé', async () => {
  const { plugin } = charger(ETAT_TEST); await plugin.onload();
  assert.equal(plugin.moteur.ignorer('Cours/Séance 1.MP4'), true);
  assert.equal(plugin.moteur.ignorer('Cours/TD.pdf'), false);
  plugin.etat.partagerVideos = true;
  assert.equal(plugin.moteur.ignorer('Cours/Séance 1.MP4'), false);
});

test('le menu des dossiers exclut puis repartage le dossier, seulement connecté', async () => {
  const { plugin, rendu, obsidian } = charger({ ...ETAT_TEST, dossiersIgnores: 'Perso' });
  await plugin.onload();
  const evenements = new Map();
  plugin.registerEvent = () => {};
  plugin.app.vault.on = () => ({});
  plugin.app.workspace.on = (nom, action) => { const actions = evenements.get(nom) || []; actions.push(action); evenements.set(nom, actions); return {}; };
  for (const nom of ['annoncerPresence', 'actualiserCalendriers', 'demarrerMoodle', 'ecouter']) plugin[nom] = () => {};
  const ordre = [];
  const sauver = plugin.saveData.bind(plugin);
  plugin.saveData = async e => { ordre.push('sauve'); await sauver(e); };
  plugin.lancer = async () => {};
  rendu.layout(); ordre.length = 0;
  plugin.lancer = async options => { ordre.push('synchro'); assert.equal(options?.forcer, true); };
  const dossier = Object.assign(new obsidian.TFolder(), { path: 'Cours' });
  const lireMenu = fichier => {
    const entrees = [];
    const menu = { addItem(creer) { const i = { setTitle(t) { this.titre = t; return this; }, setIcon() { return this; }, onClick(action) { this.action = action; return this; } }; creer(i); entrees.push(i); } };
    for (const action of evenements.get('file-menu')) action(menu, fichier);
    return entrees;
  };
  let menu = lireMenu(dossier);
  assert.deepEqual(menu.map(i => i.titre), ['Ne pas partager ce dossier']);
  await menu[0].action();
  assert.equal(rendu.sauvegarde.dossiersIgnores, 'Perso, Cours');
  assert.deepEqual(ordre, ['sauve', 'synchro']);
  assert.equal(plugin.moteur.ignorer('Cours/note.md'), true);
  assert.equal(plugin.moteur.ignorer('Cours-bis/note.md'), false);
  assert.equal(rendu.notice, 'Ce dossier n’est plus partagé.');
  menu = lireMenu(dossier); assert.equal(menu[0].titre, 'Partager à nouveau ce dossier');
  await menu[0].action();
  assert.equal(plugin.etat.dossiersIgnores, 'Perso');
  assert.equal(plugin.moteur.ignorer('Cours/note.md'), false);
  assert.equal(rendu.notice, 'Ce dossier est à nouveau partagé.');
  assert.ok(lireMenu(Object.assign(new obsidian.TFile(), { path: 'note.md' })).every(i => !i.titre.includes('dossier')));
  plugin.etat.jeton = ''; assert.equal(lireMenu(dossier).length, 0);
});

test('un dossier ne change pas de partage si le réglage ne peut pas être enregistré', async () => {
  const { plugin, rendu } = charger({ ...ETAT_TEST, dossiersIgnores: 'Perso' }); await plugin.onload();
  plugin.saveData = async () => { throw Error('disque indisponible'); };
  plugin.lancer = () => assert.fail('pas de synchro après un échec de sauvegarde');
  await plugin.basculerPartageDossier('Cours');
  assert.equal(plugin.etat.dossiersIgnores, 'Perso'); assert.equal(rendu.notice, 'Impossible de conserver ce réglage.');
  await plugin.basculerPartageDossier('Cours, privés'); assert.equal(plugin.etat.dossiersIgnores, 'Perso');
});

test('le résumé d’absence attend une synchro réussie, compte les notes et ne revient pas', async () => {
  const maintenant = Date.now(), precedent = maintenant - 10000;
  const { plugin, rendu } = charger({ ...ETAT_TEST, prenom: 'toi', derniereOuverture: precedent, aVoir: {
    'a.md': { auteurs: ['Bruno', 'Bruno'], le: maintenant - 1000 },
    'b.md': { auteurs: ['Bruno', 'Alice'], le: maintenant - 2000 },
    'ancien.md': { auteurs: ['Alice'], le: precedent - 1 },
    'pendant.md': { auteurs: ['Alice'], le: maintenant + 1000 },
  } }, { Date: class extends Date { static now() { return maintenant; } } });
  await plugin.onload();
  plugin.verifierVersions = () => {};
  plugin.moteur.synchroniser = async () => { plugin.phase = 'erreur'; };
  await plugin.lancer(); assert.equal(rendu.notices.length, 0);
  plugin.moteur.synchroniser = async () => { plugin.phase = 'ok'; };
  await plugin.lancer();
  assert.deepEqual(rendu.notices, ['Pendant ton absence : Bruno a modifié 2 notes, Alice 1.']);
  assert.equal(rendu.sauvegarde.derniereOuverture, maintenant);
  await plugin.lancer(); assert.equal(rendu.notices.length, 1);
  const suivant = charger(rendu.sauvegarde); await suivant.plugin.onload();
  suivant.plugin.resumerAbsence(); assert.equal(suivant.rendu.notices.length, 0);
});

test('le résumé d’absence ignore ses propres changements et la première ouverture', async () => {
  const maintenant = Date.now();
  for (const avant of [maintenant - 10000, 0]) {
    const { plugin, rendu } = charger({ ...ETAT_TEST, prenom: 'Alice', derniereOuverture: avant, aVoir: {
      'moi.md': { auteurs: ['Alice'], le: maintenant - 1000 },
      ...(avant ? {} : { 'ami.md': { auteurs: ['Bruno'], le: maintenant - 1000 } }),
    } });
    await plugin.onload(); plugin.resumerAbsence(); assert.equal(rendu.notices.length, 0);
  }
});

test('le filtre des changements masque les cartes sans requête et ignore casse et accents', async () => {
  const { plugin, rendu } = charger(ETAT_TEST); await plugin.onload();
  const changement = { auteurId: 'm1', auteur: 'Alice', le: Date.now() };
  let appels = 0;
  plugin.moteur.api = async () => { appels++; return { json: async () => ({ ...INFO_TEST, changements: [
    { ...changement, rev: 2, chemin: 'Électricité/Résumé.md' },
    { ...changement, rev: 1, chemin: 'Cours/Autre.md' },
  ] }) }; };
  await plugin.ruban.callback();
  const t = rendu.modal.tableau, [premiere, seconde] = t.zone.children, avant = appels;
  assert.equal(t.recherche.getAttribute('placeholder'), 'Filtrer…');
  t.recherche.value = 'ELECTRICITE/reSUME'; t.recherche.oninput();
  assert.equal(premiere.hidden, false); assert.equal(seconde.hidden, true); assert.equal(appels, avant);
  await t.charger(); assert.equal(seconde.hidden, true, 'le filtre reste appliqué après actualisation');
  t.recherche.value = 'introuvable'; t.recherche.oninput(); assert.equal(premiere.hidden, true);
  t.recherche.value = ''; t.recherche.oninput();
  assert.equal(premiere.hidden, false); assert.equal(seconde.hidden, false);
  assert.equal(t.zone.children[0], premiere, 'les cartes conservent leur identité');
});

test('le clic sur le statut ouvre les cinq actions et conserve le panneau sans Menu', async () => {
  const { plugin, rendu, obsidian } = charger(ETAT_TEST); await plugin.onload();
  const appels = [];
  plugin.ouvrirPanneau = () => appels.push('panneau');
  rendu.clicStatut(); assert.deepEqual(appels, ['panneau']); appels.length = 0;
  obsidian.Menu = class {
    constructor() { this.entrees = []; rendu.menu = this; }
    addItem(creer) { const i = { setTitle(t) { this.titre = t; return this; }, setIcon() { return this; }, onClick(action) { this.action = action; return this; } }; creer(i); this.entrees.push(i); }
    showAtMouseEvent(evt) { this.evt = evt; }
    showAtPosition(pos) { this.position = pos; }
  };
  plugin.lancer = options => appels.push(['synchro', options.forcer]);
  plugin.mettreEnPause = pause => appels.push(['pause', pause]);
  plugin.ouvrirSemaine = () => appels.push('semaine');
  plugin.ouvrirProchainAVoir = () => appels.push('prochain');
  const evt = { clientX: 10, clientY: 20 }; rendu.clicStatut(evt);
  assert.deepEqual(rendu.menu.entrees.map(i => i.titre), ['Synchroniser', 'Pause', 'Ouvrir le panneau', 'Ouvrir la semaine', 'Ouvrir la prochaine note à voir']);
  assert.equal(rendu.menu.evt, evt);
  for (const i of rendu.menu.entrees) await i.action();
  assert.deepEqual(appels, [['synchro', true], ['pause', true], 'panneau', 'semaine', 'prochain']);
  plugin.etat.enPause = true; plugin.barre.getBoundingClientRect = () => ({ left: 3, top: 4 });
  rendu.clicStatut(); assert.equal(rendu.menu.entrees[1].titre, 'Reprendre');
  assert.deepEqual({ ...rendu.menu.position }, { x: 3, y: 4 });
  await rendu.menu.entrees[1].action(); assert.deepEqual(appels.at(-1), ['pause', false]);
});
