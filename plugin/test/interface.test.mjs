import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function charger(etat) {
  const rendu = { textes: [], boutons: new Map(), ouvertures: 0 };
  const container = () => ({ empty() { rendu.textes = []; rendu.boutons.clear(); }, createEl(tag, { text }) { rendu.textes.push(text); } });
  const champ = { inputEl: {}, setValue() { return this; }, setPlaceholder() { return this; }, onChange() { return this; } };
  const obsidian = {
    Plugin: class {
      constructor() { this.app = { workspace: { onLayoutReady() {} } }; }
      async loadData() { return etat; }
      addStatusBarItem() { return { setText() {} }; }
      addSettingTab(tab) { this.onglet = tab; }
      addRibbonIcon(id, label, callback) { this.ruban = { id, label, callback }; }
      addCommand() {}
    },
    PluginSettingTab: class { constructor(app) { this.app = app; this.containerEl = container(); } },
    Modal: class { constructor(app) { this.app = app; this.contentEl = container(); } open() { rendu.ouvertures++; this.onOpen(); } },
    Setting: class {
      setName() { return this; }
      setDesc() { return this; }
      addText(callback) { callback(champ); return this; }
      addButton(callback) {
        let label;
        callback({ setButtonText(text) { label = text; return this; }, setCta() { return this; }, setWarning() { return this; }, onClick(action) { rendu.boutons.set(label, action); return this; } });
        return this;
      }
    },
    addIcon(id, svg) { rendu.icone = { id, svg }; },
  };
  const context = { require: () => obsidian, module: { exports: {} }, TextEncoder, TextDecoder, clearTimeout };
  vm.runInNewContext(readFileSync(new URL('../main.js', import.meta.url), 'utf8'), context);
  return { plugin: new context.module.exports(), rendu };
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
