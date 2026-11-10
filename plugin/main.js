/* Cordée : extension Obsidian pour partager un coffre entre amis via un serveur auto-hébergé.
 * Fichier unique en JavaScript, sans étape de compilation, pour être lisible et vérifiable par tous.
 *
 * Principe de la synchro :
 * - le serveur garde la liste des fichiers et un numéro de révision qui augmente à chaque changement ;
 * - l'extension retient, pour chaque fichier, l'empreinte (SHA-256) de la dernière version commune (la « base ») ;
 * - si les deux côtés ont modifié une note, on fusionne ligne à ligne base / locale / distante ;
 *   pour une image ou un PDF, on garde les deux fichiers.
 */
'use strict';

let O = null;
try { O = require('obsidian'); } catch (e) { O = null; } // absent dans les tests

/* ---------- Outils purs (testés hors d'Obsidian) ---------- */

const enc = new TextEncoder();
const dec = new TextDecoder();
const versBuffer = (s) => { const u = enc.encode(s); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); };
const versTexte = (b) => dec.decode(new Uint8Array(b));

async function empreinte(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

const EXT_TEXTE = new Set(['md', 'txt', 'csv']);
const estTexte = (chemin) => EXT_TEXTE.has((chemin.split('.').pop() || '').toLowerCase());

// Pour chaque ligne de x, indice de la ligne correspondante dans y (plus longue sous-suite commune), ou -1.
function correspondances(x, y) {
  const n = x.length, m = y.length, L = m + 1;
  const dp = new Int32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * L + j] = x[i] === y[j] ? dp[(i + 1) * L + j + 1] + 1 : Math.max(dp[(i + 1) * L + j], dp[i * L + j + 1]);
  const map = new Int32Array(n).fill(-1);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { map[i] = j; i++; j++; }
    else if (dp[(i + 1) * L + j] >= dp[i * L + j + 1]) i++;
    else j++;
  }
  return map;
}

const egal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Fusion à trois versions, ligne à ligne. Là où les deux côtés ont modifié le même passage différemment,
 * on garde les deux à la suite (version locale puis distante) et on signale le conflit.
 */
function fusionner(base, locale, distante) {
  const B = base.split('\n'), A = locale.split('\n'), C = distante.split('\n');
  if (B.length * Math.max(A.length, C.length) > 9e6) {
    return { texte: locale + '\n' + distante, conflit: true }; // note énorme : on ne risque pas une fusion lente
  }
  const ma = correspondances(B, A), mc = correspondances(B, C);
  const sortie = [];
  let conflit = false, i = 0, ia = 0, ic = 0;
  for (;;) {
    let k = i;
    while (k < B.length && !(ma[k] >= 0 && mc[k] >= 0)) k++;
    const fa = k < B.length ? ma[k] : A.length, fc = k < B.length ? mc[k] : C.length;
    const b0 = B.slice(i, k), a0 = A.slice(ia, fa), c0 = C.slice(ic, fc);
    if (egal(a0, b0)) sortie.push(...c0);
    else if (egal(c0, b0) || egal(a0, c0)) sortie.push(...a0);
    else { conflit = true; sortie.push(...a0, ...c0); }
    if (k >= B.length) break;
    sortie.push(B[k]);
    i = k + 1; ia = fa + 1; ic = fc + 1;
  }
  return { texte: sortie.join('\n'), conflit };
}

function nomCopieConflit(chemin, qui) {
  const date = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', 'h');
  const point = chemin.lastIndexOf('.');
  const slash = chemin.lastIndexOf('/');
  const avec = ` (conflit ${qui} ${date})`;
  return point > slash ? chemin.slice(0, point) + avec + chemin.slice(point) : chemin + avec;
}

// Accepte « https://serveur/rejoindre/ABCD-EFGH-JKLM », un lien de la page d'invitation
// « https://site/rejoindre#serveur=<adresse encodée>&code=ABCD-EFGH-JKLM », ou un code seul.
// Dans ce second format, le serveur et le code sont après le « # » : le navigateur ne les
// envoie jamais au site qui héberge la page.
function lireInvitation(texte, serveurParDefaut) {
  const t = String(texte || '').trim();
  if (t.startsWith('obsidian://cordee?')) {
    try {
      const u = new URL(t);
      return invitationValide(u.searchParams);
    } catch { return null; }
  }
  const diese = t.indexOf('#');
  if (/^https?:\/\//.test(t) && diese > 0) {
    return invitationValide(new URLSearchParams(t.slice(diese + 1)));
  }
  const m = t.match(/^(https?:\/\/.+?)\/rejoindre\/([A-Za-z0-9-]+)\/?$/);
  if (m) return invitationValide(new URLSearchParams({ serveur: m[1], code: m[2] }));
  return invitationValide(new URLSearchParams({ serveur: serveurParDefaut || '', code: t }));
}

function invitationValide(params) {
  if (params.getAll('serveur').length !== 1 || params.getAll('code').length !== 1) return null;
  const serveur = (params.get('serveur') || '').replace(/\/+$/, '');
  const code = params.get('code') || '';
  try {
    const u = new URL(serveur);
    if (!['https:', 'http:'].includes(u.protocol) || !u.hostname || u.username || u.password || u.hash || u.search || !/^[A-Za-z0-9-]{1,20}$/.test(code)) return null;
    return { serveur, code };
  } catch { return null; }
}

function dansDossier(chemin, dossier) {
  const prefixe = String(dossier || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const normalise = String(chemin).replace(/\\/g, '/');
  return !!prefixe && (normalise === prefixe || normalise.startsWith(prefixe + '/'));
}

// Le dossier de configuration reste privé, y compris sur les systèmes de fichiers
// qui traitent CONFIGURATION et configuration comme le même chemin.
function dansConfiguration(chemin, dossier) {
  return dansDossier(String(chemin).toLocaleLowerCase('en-US'), String(dossier || '').toLocaleLowerCase('en-US'));
}

/* ---------- Moteur de synchro ---------- */

/**
 * etat : { serveur, coffreId, jeton, prenom, derniereRev, bases: {chemin: hash}, cache: {chemin: {mtime, taille, hash}} }
 * fichiers : { lister() -> [{chemin, mtime, taille}], lire(chemin) -> ArrayBuffer|null, ecrire(chemin, buf), supprimer(chemin), renommer(de, vers) }
 * http : ({methode, url, entetes, corps, type}) -> Promise<{statut, json(), octets()}>
 */
class Moteur {
  constructor({ etat, sauver, fichiers, http, signaler, ignorer, tailleMax }) {
    this.etat = etat;
    this.sauver = sauver || (async () => {});
    this.fichiers = fichiers;
    this.http = http;
    this.signaler = signaler || (() => {});
    this.ignorer = ignorer || (() => false);
    this.tailleMax = tailleMax || 50 * 1024 * 1024;
    this.enCours = null;
    this.encore = false;
  }

  url(p) { return this.etat.serveur.replace(/\/$/, '') + p; }
  racine() { return `/api/coffres/${this.etat.coffreId}`; }

  async api(methode, p, corps) {
    const r = await this.http({
      methode, url: this.url(p),
      entetes: { Authorization: 'Bearer ' + this.etat.jeton },
      corps: corps === undefined ? undefined : JSON.stringify(corps),
      type: corps === undefined ? undefined : 'application/json',
    });
    if (r.statut >= 400 && r.statut !== 409) {
      let msg = `Erreur ${r.statut}`;
      try { msg = (await r.json()).erreur || msg; } catch (e) { /* corps vide */ }
      const err = new Error(msg); err.statut = r.statut; throw err;
    }
    return r;
  }

  async hashLocal(chemin) {
    const f = this.fichiers.lister().find((x) => x.chemin === chemin);
    if (!f) return null;
    return this.hashFichier(f);
  }

  async hashFichier(f) {
    const c = this.etat.cache[f.chemin];
    if (c && c.mtime === f.mtime && c.taille === f.taille) return c.hash;
    const buf = await this.fichiers.lire(f.chemin);
    if (!buf) return null;
    const hash = await empreinte(buf);
    this.etat.cache[f.chemin] = { mtime: f.mtime, taille: f.taille, hash };
    return hash;
  }

  async telecharger(hash) {
    const r = await this.api('GET', `${this.racine()}/blobs/${hash}`);
    return r.octets();
  }

  async envoyerBlob(hash, buf) {
    const r = await this.http({ methode: 'PUT', url: this.url(`${this.racine()}/blobs/${hash}`), entetes: { Authorization: 'Bearer ' + this.etat.jeton }, corps: buf, type: 'application/octet-stream' });
    if (r.statut >= 400) { const erreur = new Error(`Envoi refusé (${r.statut})`); erreur.statut = r.statut; throw erreur; }
  }

  async valider(chemin, hash, base) {
    const r = await this.api('POST', `${this.racine()}/fichiers`, { chemin, hash, base });
    return r.statut;
  }

  /** Lance une synchro, ou en programme une autre si une est déjà en cours. */
  synchroniser() {
    if (this.enCours) { this.encore = true; return this.enCours; }
    this.enCours = (async () => {
      try {
        do {
          this.encore = false;
          this.signaler('synchro');
          await this.recuperer();
          const refus = await this.envoyer();
          if (refus > 0) { await this.recuperer(); await this.envoyer(); }
          await this.sauver();
        } while (this.encore);
        this.signaler('ok');
      } catch (e) {
        this.signaler('erreur', e);
      } finally {
        this.enCours = null;
      }
    })();
    return this.enCours;
  }

  async recuperer() {
    let plus = true;
    while (plus) {
      const r = await (await this.api('GET', `${this.racine()}/changements?depuis=${this.etat.derniereRev}`)).json();
      const derniers = new Map();
      for (const c of r.changements) derniers.set(c.chemin, c);
      for (const c of derniers.values()) if (!this.ignorer(c.chemin)) await this.appliquer(c);
      if (r.changements.length) this.etat.derniereRev = r.changements[r.changements.length - 1].rev;
      plus = r.plus;
      await this.sauver();
    }
  }

  async appliquer(c) {
    const base = this.etat.bases[c.chemin] || null;
    const distant = c.supprime ? null : c.hash;
    if (distant === base) return;
    const local = await this.hashLocal(c.chemin);
    if (local === distant) { this.majBase(c.chemin, distant); return; }

    if (local === base) { // rien changé ici : on prend la version distante
      if (distant === null) await this.fichiers.supprimer(c.chemin);
      else await this.fichiers.ecrire(c.chemin, await this.telecharger(distant));
      this.majBase(c.chemin, distant);
      return;
    }
    // Modifié des deux côtés.
    if (distant === null) { delete this.etat.bases[c.chemin]; return; } // supprimé là-bas, modifié ici : on garde
    if (local === null) { // supprimé ici, modifié là-bas : on récupère
      await this.fichiers.ecrire(c.chemin, await this.telecharger(distant));
      this.majBase(c.chemin, distant);
      return;
    }
    if (estTexte(c.chemin)) {
      const texteBase = base ? versTexte(await this.telecharger(base)) : '';
      const texteLocal = versTexte(await this.fichiers.lire(c.chemin));
      const texteDistant = versTexte(await this.telecharger(distant));
      const f = fusionner(texteBase, texteLocal, texteDistant);
      await this.fichiers.ecrire(c.chemin, versBuffer(f.texte));
      this.majBase(c.chemin, distant); // le résultat fusionné partira au prochain envoi
      if (f.conflit) this.signaler('conflit', c.chemin, c.auteur);
    } else {
      await this.fichiers.renommer(c.chemin, nomCopieConflit(c.chemin, this.etat.prenom || 'moi'));
      await this.fichiers.ecrire(c.chemin, await this.telecharger(distant));
      this.majBase(c.chemin, distant);
      this.signaler('conflit', c.chemin, c.auteur);
    }
  }

  majBase(chemin, hash) {
    if (hash === null) delete this.etat.bases[chemin];
    else this.etat.bases[chemin] = hash;
  }

  /** Envoie les changements locaux. Renvoie le nombre d'écritures refusées car périmées. */
  async envoyer() {
    let refus = 0;
    const presents = new Set();
    for (const f of this.fichiers.lister()) {
      if (this.ignorer(f.chemin)) continue;
      presents.add(f.chemin);
      if (f.taille > this.tailleMax) { this.signaler('fichier-trop-gros', f.chemin); continue; }
      const h = await this.hashFichier(f);
      const base = this.etat.bases[f.chemin] || null;
      if (h === null || h === base) continue;
      await this.envoyerBlob(h, await this.fichiers.lire(f.chemin));
      if ((await this.valider(f.chemin, h, base)) === 409) { refus++; continue; }
      this.etat.bases[f.chemin] = h;
    }
    const disparus = Object.keys(this.etat.bases).filter((p) => !presents.has(p) && !this.ignorer(p));
    const total = Object.keys(this.etat.bases).length;
    // Garde-fou : si la moitié du coffre disparaît d'un coup, c'est plus probablement un accident qu'un choix.
    if (disparus.length > 20 && disparus.length > total / 2) {
      this.signaler('garde-fou', disparus.length);
      return refus;
    }
    for (const p of disparus) {
      if ((await this.valider(p, null, this.etat.bases[p])) === 409) { refus++; continue; }
      delete this.etat.bases[p];
      delete this.etat.cache[p];
    }
    return refus;
  }
}

/* ---------- Intégration Obsidian ---------- */

const PAR_DEFAUT = { serveur: '', coffreId: '', nomCoffre: '', jeton: '', prenom: '', derniereRev: 0, bases: {}, cache: {}, dossiersIgnores: '', enPause: false, derniereSynchro: null };

function expliquerErreur(erreur) {
  if ([401, 403].includes(erreur?.statut)) return 'Accès refusé. Ton accès au coffre a peut-être été retiré : demande une nouvelle invitation.';
  if (erreur?.statut === 429) return 'Trop de tentatives. Patiente une minute avant de réessayer.';
  if (erreur?.statut === 413) return 'Un fichier dépasse la taille autorisée par le serveur. Réduis sa taille ou exclus son dossier, puis réessaie.';
  if (erreur?.statut >= 500) return 'Le serveur rencontre un problème. Tes notes restent sur cet appareil ; tu peux réessayer plus tard.';
  return 'Synchronisation impossible. Vérifie ta connexion et la disponibilité du serveur, puis réessaie. Tes notes locales sont conservées.';
}

const TAILLE_AVATAR_MAX = 32 * 1024;

function signatureImage(octets, type) {
  if (type === 'image/jpeg') return octets[0] === 255 && octets[1] === 216 && octets[2] === 255;
  if (type === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => octets[i] === v);
  if (type === 'image/webp') return String.fromCharCode(...octets.slice(0, 4)) === 'RIFF' && String.fromCharCode(...octets.slice(8, 12)) === 'WEBP';
  return false;
}

function avatarValide(avatar) {
  if (typeof avatar !== 'string' || avatar.length > Math.ceil(TAILLE_AVATAR_MAX / 3) * 4 + 32) return null;
  const correspond = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(avatar);
  if (!correspond || correspond[2].length % 4 !== 0) return null;
  try {
    const binaire = atob(correspond[2]);
    if (binaire.length > TAILLE_AVATAR_MAX) return null;
    const octets = Uint8Array.from(binaire.slice(0, 12), (c) => c.charCodeAt(0));
    return signatureImage(octets, correspond[1]) ? avatar : null;
  } catch { return null; }
}

async function preparerPhoto(fichier, navigateur = globalThis) {
  if (!fichier || !['image/jpeg', 'image/png', 'image/webp'].includes(fichier.type)) throw new Error('Choisis une photo JPEG, PNG ou WebP.');
  if (fichier.size <= 0 || fichier.size > 10 * 1024 * 1024) throw new Error('Choisis une photo de moins de 10 Mo.');
  const entete = new Uint8Array(await fichier.slice(0, 12).arrayBuffer());
  if (!signatureImage(entete, fichier.type)) throw new Error('Ce fichier ne correspond pas au format de photo annoncé.');
  const url = navigateur.URL.createObjectURL(fichier);
  try {
    const image = new navigateur.Image();
    await new Promise((ok, ko) => {
      image.onload = ok;
      image.onerror = () => ko(new Error('Cette photo ne peut pas être lue. Choisis une autre image.'));
      image.src = url;
    });
    const largeur = image.naturalWidth, hauteur = image.naturalHeight;
    if (!largeur || !hauteur || largeur * hauteur > 40_000_000) throw new Error('Cette photo est trop grande. Choisis une image de moins de 40 mégapixels.');
    const canvas = navigateur.document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const contexte = canvas.getContext('2d');
    if (!contexte) throw new Error('Impossible de préparer cette photo sur cet appareil.');
    contexte.fillStyle = '#ffffff';
    contexte.fillRect(0, 0, 128, 128);
    const cote = Math.min(largeur, hauteur);
    contexte.drawImage(image, (largeur - cote) / 2, (hauteur - cote) / 2, cote, cote, 0, 0, 128, 128);
    for (const qualite of [0.85, 0.7, 0.5]) {
      const avatar = canvas.toDataURL('image/jpeg', qualite);
      if (avatarValide(avatar)) return avatar;
    }
    throw new Error('La photo préparée reste trop volumineuse. Choisis une autre image.');
  } finally { navigateur.URL.revokeObjectURL(url); }
}

function afficherAvatar(c, nom, avatar) {
  const photo = avatarValide(avatar);
  const initiales = () => {
    const initiales = String(nom || '?').trim().split(/\s+/).slice(0, 2).map((partie) => Array.from(partie)[0] || '').join('').toLocaleUpperCase('fr-FR');
    return c.createEl('span', { text: initiales || '?', cls: 'cordee-avatar cordee-avatar-initiales', attr: { 'aria-label': `Profil de ${nom || 'ce membre'}` } });
  };
  if (photo) {
    const image = c.createEl('img', { cls: 'cordee-avatar', attr: { src: photo, alt: `Photo de ${nom || 'ce membre'}`, width: '36', height: '36' } });
    image.onerror = () => { image.onerror = null; image.replaceWith(initiales()); };
  } else {
    initiales();
  }
}

// Même symbole que brand/cordee-marque.svg, adapté au repère 100 × 100 d'Obsidian.
const ICONE_CORDEE = '<g transform="scale(0.390625)"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M188.29 36.97 A104 104 0 1 0 188.29 219.03 A32 32 0 1 0 166.82 189.59 A68 68 0 1 1 166.82 66.41 A32 32 0 1 0 188.29 36.97 Z M212.81 67.19 A14 14 0 1 0 184.81 67.19 A14 14 0 1 0 212.81 67.19 Z M212.81 188.81 A14 14 0 1 0 184.81 188.81 A14 14 0 1 0 212.81 188.81 Z"/></g>';

function httpObsidian({ methode, url, entetes, corps, type }) {
  return O.requestUrl({ url, method: methode, headers: entetes, body: corps, contentType: type, throw: false }).then((r) => ({
    statut: r.status, json: async () => r.json, octets: async () => r.arrayBuffer,
  }));
}

function fichiersObsidian(app) {
  const vault = app.vault;
  const verifier = (p) => { if (dansConfiguration(p, vault.configDir)) throw new Error('Le dossier de configuration du coffre n’est pas partagé.'); };
  const trouver = (p) => { if (dansConfiguration(p, vault.configDir)) return null; const f = vault.getAbstractFileByPath(p); return f instanceof O.TFile ? f : null; };
  async function dossiers(p) {
    const parts = p.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const d = parts.slice(0, i).join('/');
      if (!vault.getAbstractFileByPath(d)) await vault.createFolder(d);
    }
  }
  return {
    lister: () => vault.getFiles().filter((f) => !dansConfiguration(f.path, vault.configDir)).map((f) => ({ chemin: f.path, mtime: f.stat.mtime, taille: f.stat.size })),
    lire: async (p) => { const f = trouver(p); return f ? vault.readBinary(f) : null; },
    ecrire: async (p, buf) => { verifier(p); const f = trouver(p); if (f) await vault.modifyBinary(f, buf); else { await dossiers(p); await vault.createBinary(p, buf); } },
    supprimer: async (p) => { verifier(p); const f = trouver(p); if (f) await vault.trash(f, false); }, // corbeille locale du coffre : récupérable
    renommer: async (de, vers) => { verifier(de); verifier(vers); const f = trouver(de); if (f) await vault.rename(f, vers); },
  };
}

let InvitationModal, ActiviteModal, ProfilModal, ReglagesCordee, PanneauCordee;

class CordeePlugin extends (O ? O.Plugin : Object) {
  async onload() {
    this.etat = Object.assign({}, PAR_DEFAUT, await this.loadData());
    this.phase = 'pret';
    this.derniereErreur = '';
    this.abonnesStatut = new Set();
    this.fichiersTropGros = new Set();
    this.barre = this.addStatusBarItem();
    this.moteur = this.creerMoteur();
    this.afficher('');
    this.addSettingTab(new ReglagesCordee(this.app, this));
    O.addIcon('cordee-logo', ICONE_CORDEE);
    this.addRibbonIcon('cordee-logo', 'Cordée — ouvrir le partage', () => new PanneauCordee(this.app, this).open());
    this.addCommand({ id: 'ouvrir', name: 'Ouvrir le panneau de partage', callback: () => new PanneauCordee(this.app, this).open() });
    this.addCommand({ id: 'synchroniser', name: 'Synchroniser maintenant', callback: () => this.lancer({ forcer: true }) });
    this.addCommand({ id: 'pause', name: 'Mettre en pause ou reprendre la synchronisation', callback: () => this.mettreEnPause(!this.etat.enPause) });
    this.addCommand({ id: 'inviter', name: "Créer une invitation pour un ami", callback: () => this.inviter() });
    this.addCommand({ id: 'activite', name: 'Voir qui a modifié quoi', callback: () => new ActiviteModal(this.app, this).open() });
    this.registerObsidianProtocolHandler('cordee', (params) => {
      const invitation = invitationValide(new URLSearchParams({ serveur: params.serveur || '', code: params.code || '' }));
      if (!invitation) { new O.Notice('Ce lien Cordée est incomplet. Demande une nouvelle invitation.'); return; }
      const panneau = new PanneauCordee(this.app, this);
      if (this.connecte()) new O.Notice('Ce coffre est déjà connecté. Ouvre un coffre vide pour rejoindre un autre groupe.');
      else panneau.reglages.form.invitation = 'obsidian://cordee?' + new URLSearchParams(invitation);
      panneau.open(); // Préremplit uniquement : rejoindre exige toujours une action de l'utilisateur.
    });

    this.app.workspace.onLayoutReady(() => {
      const plus_tard = () => this.programmer(2000);
      for (const ev of ['create', 'modify', 'delete', 'rename']) this.registerEvent(this.app.vault.on(ev, plus_tard));
      this.registerInterval(window.setInterval(() => this.lancer(), 5 * 60_000)); // filet de sécurité
      this.ecouter();
      this.lancer();
    });
  }

  onunload() { this.arret = true; clearTimeout(this.minuteur); this.abonnesStatut.clear(); }

  connecte() { return !!(this.etat.serveur && this.etat.coffreId && this.etat.jeton); }

  creerMoteur() {
    return new Moteur({
      etat: this.etat,
      sauver: () => this.saveData(this.etat),
      fichiers: fichiersObsidian(this.app),
      http: httpObsidian,
      ignorer: (p) => dansConfiguration(p, this.app.vault.configDir) || this.etat.dossiersIgnores.split(',').map((s) => s.trim()).filter(Boolean).some((d) => dansDossier(p, d)),
      signaler: (quoi, a, b) => {
        if (quoi === 'synchro') { this.phase = 'synchro'; this.derniereErreur = ''; this.sourceErreur = ''; this.fichiersTropGros.clear(); this.suppressionsBloquees = 0; }
        else if (quoi === 'ok') this.phase = 'ok';
        else if (quoi === 'erreur') this.signalerErreur(a, 'synchro');
        else if (quoi === 'conflit') new O.Notice(`Cordée : ${a} modifié aussi par ${b || 'un ami'}. Les deux versions sont gardées, vérifie la note.`, 10000);
        else if (quoi === 'garde-fou') { this.suppressionsBloquees = a; new O.Notice(`Cordée : ${a} fichiers ont disparu d'un coup. Rien n'a été supprimé sur le serveur. Vérifie ton coffre.`, 0); }
        else if (quoi === 'fichier-trop-gros') this.fichiersTropGros.add(a);
        this.afficher();
      },
    });
  }

  titreStatut() {
    if (!this.connecte()) return 'non connecté';
    if (this.phase === 'synchro') return this.etat.enPause ? 'fin de la synchronisation en cours…' : 'synchronisation…';
    if (this.etat.enPause) return 'en pause';
    if (this.derniereErreur) return 'connexion à vérifier';
    if (this.fichiersTropGros.size || this.suppressionsBloquees) return 'fichiers à vérifier';
    return this.etat.derniereSynchro ? 'à jour' : 'prêt';
  }

  afficher() {
    this.barre.setText(`Cordée : ${this.titreStatut()}`);
    for (const actualiser of this.abonnesStatut) actualiser();
  }

  abonnerStatut(actualiser) {
    this.abonnesStatut.add(actualiser);
    actualiser();
    return () => this.abonnesStatut.delete(actualiser);
  }

  signalerErreur(erreur, source) {
    this.phase = 'erreur';
    this.derniereErreur = expliquerErreur(erreur);
    this.sourceErreur = source;
    this.afficher();
  }

  async mettreEnPause(enPause) {
    if (!this.connecte()) { new O.Notice('Rejoins un coffre avant de régler sa synchronisation.'); return; }
    const avant = this.etat.enPause;
    this.etat.enPause = enPause;
    clearTimeout(this.minuteur);
    this.moteur.encore = false;
    try { await this.saveData(this.etat); }
    catch {
      this.etat.enPause = avant;
      new O.Notice('Impossible de conserver ce réglage. Vérifie que le coffre est accessible en écriture.');
      this.afficher();
      return;
    }
    this.afficher();
    if (!enPause) await this.lancer();
  }

  programmer(ms) {
    if (!this.connecte() || this.etat.enPause || this.arret) return;
    clearTimeout(this.minuteur);
    this.minuteur = setTimeout(() => this.lancer(), ms);
  }

  async lancer({ forcer = false } = {}) {
    if (!this.connecte() || this.arret || (this.etat.enPause && !forcer)) return;
    await this.moteur.synchroniser();
    if (this.phase === 'ok') {
      this.etat.derniereSynchro = Date.now();
      try { await this.saveData(this.etat); }
      catch { this.derniereErreur = 'Impossible de conserver l’état local. Vérifie que le dossier du coffre est accessible en écriture.'; }
      this.afficher();
    }
  }

  // requestUrl fonctionne aussi sur mobile, sans dépendre d'un flux fetch/CORS.
  ecouter() {
    this.registerInterval(window.setInterval(async () => {
      if (this.arret || !this.connecte() || this.etat.enPause || this.ecouteEnCours) return;
      this.ecouteEnCours = true;
      try {
        const info = await (await this.moteur.api('GET', `/api/coffres/${this.etat.coffreId}?revision=1`)).json();
        if (!this.arret && this.connecte() && info.rev > this.etat.derniereRev) await this.lancer();
        else if (!this.arret && this.connecte() && !this.moteur.enCours) {
          if (this.sourceErreur === 'sondage') { this.derniereErreur = ''; this.phase = 'pret'; }
          this.afficher();
        }
      } catch (erreur) { if (!this.arret && this.connecte() && this.sourceErreur !== 'synchro') this.signalerErreur(erreur, 'sondage'); }
      finally { this.ecouteEnCours = false; }
    }, 2500));
  }

  async rejoindreOuCreer(chemin, corps, serveur) {
    const r = await httpObsidian({ methode: 'POST', url: serveur.replace(/\/$/, '') + chemin, corps: JSON.stringify(corps), type: 'application/json' });
    const j = await r.json();
    if (r.statut >= 400) throw new Error((j && j.erreur) || `Erreur ${r.statut}`);
    Object.assign(this.etat, { serveur: serveur.replace(/\/$/, ''), coffreId: j.coffreId, nomCoffre: j.nom, jeton: j.jeton, prenom: corps.prenom, derniereRev: 0, bases: {}, cache: {}, enPause: false, derniereSynchro: null });
    await this.saveData(this.etat);
    this.afficher('');
    await this.lancer();
  }

  async inviter() {
    try {
      const r = await (await this.moteur.api('POST', `/api/coffres/${this.etat.coffreId}/invitations`, {})).json();
      const lien = r.lien || `${this.etat.serveur}/rejoindre/${r.code}`;
      new InvitationModal(this.app, lien).open();
    } catch (e) { new O.Notice('Cordée : ' + e.message); }
  }

  async quitter() {
    try { await this.moteur.api('DELETE', `/api/coffres/${this.etat.coffreId}/membres/moi`); } catch (e) { /* hors ligne : on oublie quand même localement */ }
    Object.assign(this.etat, { coffreId: '', nomCoffre: '', jeton: '', derniereRev: 0, bases: {}, cache: {}, enPause: false, derniereSynchro: null });
    await this.saveData(this.etat);
    this.afficher('');
  }
}

if (O) {
  InvitationModal = class extends O.Modal {
    constructor(app, lien) { super(app); this.lien = lien; }
    onOpen() {
      const { contentEl: c } = this;
      c.createEl('h3', { text: 'Invitation prête' });
      c.createEl('p', { text: "Envoie ce lien à ton ami. Il est valable 7 jours, pour 5 personnes au plus." });
      const champ = c.createEl('input', { type: 'text', value: this.lien, cls: 'cordee-lien-invitation' }); champ.readOnly = true;
      new O.Setting(c).addButton((b) => b.setButtonText('Copier').setCta().onClick(async () => {
        try { await navigator.clipboard.writeText(this.lien); new O.Notice('Lien copié'); } catch (e) { champ.select(); }
      }));
    }
    onClose() { this.contentEl.empty(); }
  };

  ProfilModal = class extends O.Modal {
    constructor(app, plugin) { super(app); this.plugin = plugin; }
    async onOpen() {
      const { contentEl: c } = this;
      this.ferme = false;
      const tour = this.tour = (this.tour || 0) + 1;
      const coffreId = this.plugin.etat.coffreId, jeton = this.plugin.etat.jeton;
      const actif = () => !this.ferme && this.tour === tour && !this.plugin.arret && this.plugin.etat.coffreId === coffreId && this.plugin.etat.jeton === jeton;
      c.empty();
      c.createEl('h3', { text: 'Mon profil' });
      c.createEl('p', { text: 'Ta photo sera visible par les membres de ce coffre, à côté de tes changements. Elle est recadrée en carré et ses métadonnées sont retirées sur cet appareil.' });
      const etat = c.createEl('p', { text: 'Chargement du profil…', cls: 'cordee-details', attr: { role: 'status', 'aria-live': 'polite' } });
      try {
        const info = await (await this.plugin.moteur.api('GET', `/api/coffres/${coffreId}`)).json();
        if (!actif()) return;
        const moi = info.membres?.find((membre) => membre.id && membre.id === info.moiId);
        if (!moi) { etat.setText('Les photos de profil demandent une mise à jour du serveur Cordée. La synchronisation reste disponible.'); return; }
        let actuel = avatarValide(moi.avatar), choix = null, lecture = 0, occupe = false;
        const apercu = c.createEl('div', { cls: 'cordee-profil-apercu' });
        const montrer = (avatar) => { apercu.empty(); afficherAvatar(apercu, moi.nom, avatar); apercu.createEl('span', { text: moi.nom }); };
        montrer(actuel);
        c.createEl('label', { text: 'Choisir une photo (JPEG, PNG ou WebP, 10 Mo maximum)', cls: 'cordee-details' });
        const fichier = c.createEl('input', { type: 'file', cls: 'cordee-choix-photo', attr: { accept: 'image/jpeg,image/png,image/webp', 'aria-label': 'Choisir ma photo de profil' } });
        let enregistrer, retirer;
        const boutons = () => { enregistrer?.setDisabled(occupe || !choix); retirer?.setDisabled(occupe || !actuel); fichier.disabled = occupe; };
        const sauver = async (avatar) => {
          if (!actif() || occupe) return;
          occupe = true; ++lecture; boutons(); etat.setText('Enregistrement du profil…');
          try {
            const profil = await (await this.plugin.moteur.api('PUT', `/api/coffres/${coffreId}/profil`, { avatar })).json();
            if (!actif()) return;
            actuel = avatarValide(profil.avatar); choix = null; fichier.value = ''; montrer(actuel);
            etat.setText(actuel ? 'Photo enregistrée. Les membres la verront en ouvrant ou en actualisant l’activité.' : 'Photo retirée. Tes initiales seront affichées.');
          } catch (erreur) {
            if (actif()) etat.setText(erreur.statut === 404 ? 'Ce serveur ne prend pas encore en charge les photos. Mets le serveur Cordée à jour.' : 'Photo non enregistrée. ' + expliquerErreur(erreur));
          } finally { if (actif()) { occupe = false; boutons(); } }
        };
        new O.Setting(c).addButton((b) => { enregistrer = b; b.setButtonText('Enregistrer la photo').setCta().onClick(() => choix && sauver(choix)); }).addButton((b) => { retirer = b; b.setButtonText('Retirer la photo').onClick(() => actuel && sauver(null)); });
        fichier.onchange = async () => {
          const selection = ++lecture;
          choix = null; boutons();
          const photo = fichier.files?.[0];
          if (!photo) { montrer(actuel); etat.setText('Aucune nouvelle photo sélectionnée.'); return; }
          etat.setText('Préparation de la photo sur cet appareil…');
          try {
            const avatar = await preparerPhoto(photo);
            if (!actif() || selection !== lecture) return;
            choix = avatar; montrer(choix); etat.setText('Aperçu prêt. Clique sur « Enregistrer la photo » pour la partager.');
          } catch (erreur) { if (actif() && selection === lecture) { montrer(actuel); etat.setText(erreur.message); } }
          if (actif() && selection === lecture) boutons();
        };
        etat.setText(actuel ? 'Ta photo actuelle est partagée avec ce coffre.' : 'Aucune photo partagée. Tes initiales sont affichées.');
        boutons();
      } catch (erreur) { if (actif()) etat.setText('Impossible de charger ton profil. ' + expliquerErreur(erreur)); }
    }
    onClose() { this.ferme = true; ++this.tour; this.contentEl.empty(); }
  };

  ActiviteModal = class extends O.Modal {
    constructor(app, plugin) { super(app); this.plugin = plugin; }
    async onOpen() {
      const { contentEl: c } = this;
      this.ferme = false;
      const tour = this.tour = (this.tour || 0) + 1;
      const coffreId = this.plugin.etat.coffreId, jeton = this.plugin.etat.jeton;
      const actif = () => !this.ferme && this.tour === tour && !this.plugin.arret && this.plugin.etat.coffreId === coffreId && this.plugin.etat.jeton === jeton;
      c.empty();
      c.createEl('h3', { text: 'Membres et activité' });
      try {
        const info = await (await this.plugin.moteur.api('GET', `/api/coffres/${coffreId}`)).json();
        if (!actif()) return;
        c.createEl('h4', { text: `${info.membres.length} membre${info.membres.length > 1 ? 's' : ''}` });
        const membres = c.createEl('ul', { cls: 'cordee-activite' });
        for (const membre of info.membres) {
          const ligne = membres.createEl('li', { cls: 'cordee-personne' });
          afficherAvatar(ligne, membre.nom, membre.avatar);
          ligne.createEl('span', { text: `${membre.nom} · arrivé le ${new Date(membre.arrive_le).toLocaleDateString('fr-FR')}` });
        }
        const profils = new Map(info.membres.filter((membre) => membre.id).map((membre) => [membre.id, membre]));
        const r = await (await this.plugin.moteur.api('GET', `/api/coffres/${coffreId}/changements?depuis=${Math.max(0, info.rev - 40)}`)).json();
        if (!actif()) return;
        c.createEl('h4', { text: 'Derniers changements' });
        if (!r.changements.length) c.createEl('p', { text: 'Aucun changement partagé pour le moment.' });
        const liste = c.createEl('ul', { cls: 'cordee-activite' });
        for (const ch of r.changements.slice(-40).reverse()) {
          const ligne = liste.createEl('li', { cls: 'cordee-personne' });
          afficherAvatar(ligne, ch.auteur, profils.get(ch.auteurId)?.avatar);
          const contenu = ligne.createEl('div');
          contenu.createEl('span', { text: `${ch.auteur || '?'} · ${ch.supprime ? 'a supprimé' : 'a modifié'} ${ch.chemin}` });
          contenu.createEl('div', { text: new Date(ch.le).toLocaleString('fr-FR'), cls: 'cordee-details' });
        }
        new O.Setting(c).addButton((b) => b.setButtonText('Actualiser').onClick(() => this.onOpen()));
      } catch (e) { if (actif()) c.createEl('p', { text: expliquerErreur(e) }); }
    }
    onClose() { this.ferme = true; this.contentEl.empty(); }
  };

  ReglagesCordee = class extends O.PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; this.form = { serveur: '', prenom: '', invitation: '', nom: '', code: '', dossiersIgnores: plugin.etat.dossiersIgnores || '' }; }
    display() {
      this.afficherDans(this.containerEl, () => this.display());
    }
    nettoyer() { if (this.desabonner) { this.desabonner(); this.desabonner = null; } }
    hide() { this.nettoyer(); }
    afficherDans(c, rafraichir) {
      const p = this.plugin, e = p.etat, f = this.form;
      this.nettoyer();
      c.empty();
      if (p.connecte()) {
        c.createEl('h3', { text: `Coffre partagé : ${e.nomCoffre}` });
        c.createEl('p', { text: `Serveur ${e.serveur} · connecté en tant que ${e.prenom}` });
        const statut = c.createEl('p', { cls: 'cordee-etat' });
        const chiffres = c.createEl('p', { cls: 'cordee-details' });
        const attention = c.createEl('p', { cls: 'cordee-attention' });
        let boutonPause;
        const automatique = new O.Setting(c).setName('Synchronisation automatique').addButton((b) => { boutonPause = b; b.onClick(async () => { await p.mettreEnPause(!e.enPause); }); });
        this.desabonner = p.abonnerStatut(() => {
          boutonPause.setButtonText(e.enPause ? 'Reprendre' : 'Mettre en pause');
          automatique.setDesc(e.enPause ? 'Tes prochaines modifications resteront locales jusqu’à la reprise.' : 'Envoi des modifications et réception des changements du groupe.');
          statut.setText(p.titreStatut());
          const derniere = e.derniereSynchro ? new Date(e.derniereSynchro).toLocaleString('fr-FR') : 'pas encore effectuée';
          chiffres.setText(`${Object.keys(e.bases).length} fichiers partagés · Dernière synchronisation : ${derniere}`);
          attention.setText(p.derniereErreur || (p.suppressionsBloquees ? `${p.suppressionsBloquees} suppressions bloquées par le garde-fou.` : p.fichiersTropGros.size ? `${p.fichiersTropGros.size} fichier(s) dépassent la limite de 50 Mo et n’ont pas été envoyés.` : e.enPause ? 'Les prochaines synchronisations sont suspendues. Une opération déjà lancée se termine normalement.' : ''));
          attention.hidden = !attention.textContent;
        });
        new O.Setting(c).setName('Inviter un ami').setDesc('Crée un lien à lui envoyer.').addButton((b) => b.setButtonText('Créer une invitation').setCta().onClick(() => p.inviter()));
        new O.Setting(c).setName('Synchroniser maintenant').setDesc('Lance une synchronisation ponctuelle, même pendant la pause.').addButton((b) => b.setButtonText('Synchroniser').onClick(() => p.lancer({ forcer: true })));
        new O.Setting(c).setName('Membres et activité').setDesc('Retrouve les membres du groupe et les 40 derniers changements.').addButton((b) => b.setButtonText('Voir l’activité').onClick(() => new ActiviteModal(this.app, p).open()));
        new O.Setting(c).setName('Photo de profil').setDesc('Une photo ou tes initiales à côté de tes changements, pour les membres de ce coffre.').addButton((b) => b.setButtonText('Mon profil').onClick(() => new ProfilModal(this.app, p).open()));
        new O.Setting(c).setName('Dossiers non partagés').setDesc('Séparés par des virgules, par exemple : Brouillons, Perso').addText((t) => t.setValue(e.dossiersIgnores).onChange(async (v) => { e.dossiersIgnores = v; await p.saveData(e); }));
        new O.Setting(c).setName('Quitter ce coffre').setDesc('Tes fichiers restent sur ton ordinateur ; ils ne se synchronisent plus.').addButton((b) => b.setButtonText('Quitter').setWarning().onClick(async () => { await p.quitter(); rafraichir(); }));
        return;
      }
      c.createEl('h3', { text: 'Rejoindre un coffre' });
      c.createEl('p', { text: 'Pars de préférence d’un coffre vide. Les notes de ce coffre seront partagées avec le groupe.' });
      new O.Setting(c).setName("Lien d'invitation").setDesc('Ouvre le lien reçu depuis le site, ou colle-le ici.').addText((t) => t.setValue(f.invitation).onChange((v) => { f.invitation = v; }));
      new O.Setting(c).setName('Ton prénom').setDesc('Visible par les autres membres.').addText((t) => t.setValue(f.prenom).onChange((v) => { f.prenom = v; }));
      new O.Setting(c).addButton((b) => b.setButtonText('Rejoindre').setCta().onClick(async () => {
        const inv = lireInvitation(f.invitation, f.serveur);
        if (!inv?.serveur || !/^[A-Za-z0-9-]{1,20}$/.test(inv.code)) { new O.Notice('Colle une invitation complète et valide.'); return; }
        if (!f.prenom.trim()) { new O.Notice('Indique ton prénom pour rejoindre.'); return; }
        e.dossiersIgnores = f.dossiersIgnores;
        try { await p.rejoindreOuCreer('/api/rejoindre', { code: inv.code, prenom: f.prenom.trim() }, inv.serveur); rafraichir(); }
        catch (err) { new O.Notice('Cordée : ' + err.message); }
      }));
      new O.Setting(c).setName('Dossiers non partagés').setDesc('Facultatif. À exclure avant le premier envoi, séparés par des virgules.').addText((t) => t.setValue(f.dossiersIgnores).onChange((v) => { f.dossiersIgnores = v; }));
      c.createEl('h3', { text: 'Ou créer un coffre partagé' });
      c.createEl('p', { text: "Il faut le code de création donné par la personne qui héberge le serveur. Tout ce coffre sera envoyé." });
      new O.Setting(c).setName('Adresse du serveur').addText((t) => t.setPlaceholder('https://cordee.exemple.fr').setValue(f.serveur).onChange((v) => { f.serveur = v.trim(); }));
      new O.Setting(c).setName('Nom du coffre').addText((t) => t.setValue(f.nom).onChange((v) => { f.nom = v; }));
      new O.Setting(c).setName('Ton prénom').addText((t) => t.setValue(f.prenom).onChange((v) => { f.prenom = v; }));
      new O.Setting(c).setName('Code de création').addText((t) => { t.inputEl.type = 'password'; t.onChange((v) => { f.code = v; }); });
      new O.Setting(c).addButton((b) => b.setButtonText('Créer et partager').setCta().onClick(async () => {
        if (!invitationValide(new URLSearchParams({ serveur: f.serveur, code: 'test' }))) { new O.Notice('Indique une adresse de serveur HTTP ou HTTPS valide.'); return; }
        if (!f.nom.trim() || !f.prenom.trim() || !f.code.trim()) { new O.Notice('Indique le nom du coffre, ton prénom et le code de création.'); return; }
        e.dossiersIgnores = f.dossiersIgnores;
        try { await p.rejoindreOuCreer('/api/coffres', { nom: f.nom, prenom: f.prenom, codeCreation: f.code }, f.serveur); rafraichir(); }
        catch (err) { new O.Notice('Cordée : ' + err.message); }
      }));
    }
  };

  PanneauCordee = class extends O.Modal {
    constructor(app, plugin) { super(app); this.reglages = new ReglagesCordee(app, plugin); }
    onOpen() { this.reglages.afficherDans(this.contentEl, () => this.onOpen()); }
    onClose() { this.reglages.nettoyer(); this.contentEl.empty(); }
  };
}

module.exports = CordeePlugin;
module.exports.default = CordeePlugin;
module.exports.interne = { fusionner, Moteur, empreinte, versBuffer, versTexte, nomCopieConflit, lireInvitation, expliquerErreur, avatarValide, preparerPhoto };
