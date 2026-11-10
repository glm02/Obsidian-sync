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

const CLE_PREFERENCES = 'cordee.preferences.v1';

function lirePreferences() {
  try {
    const valeur = JSON.parse(globalThis.localStorage?.getItem(CLE_PREFERENCES) || '{}');
    const invitation = invitationValide(new URLSearchParams({ serveur: valeur?.serveur || '', code: 'test' }));
    return { serveur: invitation?.serveur || '', prenom: typeof valeur?.prenom === 'string' ? valeur.prenom.trim().slice(0, 60) : '' };
  } catch { return { serveur: '', prenom: '' }; }
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
    this.etat.dossiers = Object.assign(Object.create(null), this.etat.dossiers || {});
    // Changements reçus mais impossibles à appliquer ici (ex. nom qui ne diffère que par les majuscules sur Windows).
    // On les garde de côté et on les réessaie à chaque synchro : ils ne doivent pas bloquer le reste.
    this.etat.enAttente = Object.assign(Object.create(null), this.etat.enAttente || {});
    this.sauver = sauver || (async () => {});
    this.fichiers = fichiers;
    this.http = http;
    this.signaler = signaler || (() => {});
    this.ignorer = ignorer || (() => false);
    this.tailleMax = tailleMax || 50 * 1024 * 1024;
    this.enCours = null;
    this.encore = false;
  }

  /**
   * Le garde-fou retient une disparition massive (plus de 20 éléments et plus de la moitié du coffre) : c'est
   * plus souvent un accident qu'un choix. Quand c'est voulu, l'utilisateur la confirme : la suppression part
   * alors à la prochaine synchro, une seule fois, et se propage chez tous les membres.
   */
  suppressionsEnAttente() { return (this.suppressionsFichiers || 0) + (this.suppressionsDossiers || 0); }
  autoriserSuppressions() { this.suppressionsAutorisees = true; if (this.enCours) this.encore = true; }

  url(p) { return this.etat.serveur.replace(/\/$/, '') + p; }
  racine() { return `/api/coffres/${this.etat.coffreId}`; }

  async api(methode, p, corps) {
    let r;
    try {
      r = await this.http({
        methode, url: this.url(p),
        entetes: { Authorization: 'Bearer ' + this.etat.jeton, 'X-Cordee-Version': VERSION },
        corps: corps === undefined ? undefined : JSON.stringify(corps),
        type: corps === undefined ? undefined : 'application/json',
      });
    } catch (e) { e.reseau = true; throw e; } // pas de réponse du serveur : c'est bien un problème de connexion
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
    let r;
    try { r = await this.http({ methode: 'PUT', url: this.url(`${this.racine()}/blobs/${hash}`), entetes: { Authorization: 'Bearer ' + this.etat.jeton, 'X-Cordee-Version': VERSION }, corps: buf, type: 'application/octet-stream' }); }
    catch (e) { e.reseau = true; throw e; }
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
        this.suppressionsAutorisees = false; // la confirmation ne vaut que pour cette synchro
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
    const traites = new Set();
    while (plus) {
      const r = await (await this.api('GET', `${this.racine()}/changements?depuis=${this.etat.derniereRev}`)).json();
      const derniers = new Map();
      for (const c of r.changements) derniers.set(`${c.type || 'fichier'}:${c.chemin}`, c);
      for (const [cle, c] of [...derniers.entries()].sort((a, b) => a[1].rev - b[1].rev)) {
        traites.add(cle);
        if (!this.ignorer(c.chemin)) await this.appliquerSansBloquer(c);
      }
      if (r.changements.length) this.etat.derniereRev = r.changements[r.changements.length - 1].rev;
      plus = r.plus;
      await this.sauver();
    }
    // Les changements mis de côté lors d'une synchro précédente : une nouvelle chance, sans bloquer le reste.
    for (const [cle, c] of Object.entries(this.etat.enAttente)) {
      if (traites.has(cle)) continue;
      if (this.ignorer(c.chemin)) { delete this.etat.enAttente[cle]; continue; }
      await this.appliquerSansBloquer(c);
    }
    await this.sauver();
  }

  /**
   * Applique un changement reçu. Si l'écriture échoue sur CET appareil (nom déjà pris à la casse près,
   * fichier verrouillé…), le changement est mis de côté et le reste de la synchro continue :
   * un seul fichier récalcitrant ne doit pas empêcher d'envoyer ni de recevoir les autres.
   * Un vrai problème de serveur ou de réseau, lui, arrête la synchro comme avant.
   */
  async appliquerSansBloquer(c) {
    const cle = `${c.type || 'fichier'}:${c.chemin}`;
    try {
      await this.appliquer(c);
      delete this.etat.enAttente[cle];
    } catch (e) {
      if (e?.reseau || [401, 403, 429].includes(e?.statut) || e?.statut >= 500) throw e;
      this.etat.enAttente[cle] = { rev: c.rev, chemin: c.chemin, hash: c.hash ?? null, supprime: !!c.supprime, type: c.type || 'fichier', auteur: c.auteur ?? null };
      this.signaler('fichier-bloque', c.chemin, e);
    }
  }

  async appliquer(c) {
    if (c.type === 'dossier') {
      if (!this.fichiers.creerDossier || !this.fichiers.supprimerDossierVide) return;
      if (c.supprime) {
        const retire = await this.fichiers.supprimerDossierVide(c.chemin);
        delete this.etat.dossiers[c.chemin];
        if (!retire) this.signaler('dossier-conserve', c.chemin);
      } else {
        await this.fichiers.creerDossier(c.chemin);
        this.etat.dossiers[c.chemin] = c.rev;
      }
      return;
    }
    const base = this.etat.bases[c.chemin] || null;
    const distant = c.supprime ? null : c.hash;
    if (distant === base) return;
    const local = await this.hashLocal(c.chemin);
    if (local === distant) { this.majBase(c.chemin, distant); return; }

    if (local === base) { // rien changé ici : on prend la version distante
      if (distant === null) await this.fichiers.supprimer(c.chemin);
      else await this.ecrireDistant(c, distant, local === null ? null : undefined);
      this.majBase(c.chemin, distant);
      return;
    }
    // Modifié des deux côtés.
    if (distant === null) { delete this.etat.bases[c.chemin]; return; } // supprimé là-bas, modifié ici : on garde
    if (local === null) { // supprimé ici, modifié là-bas : on récupère
      await this.ecrireDistant(c, distant, null);
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
      this.signalerModif(c, texteLocal, f.texte);
      if (f.conflit) this.signaler('conflit', c.chemin, c.auteur);
    } else {
      await this.fichiers.renommer(c.chemin, nomCopieConflit(c.chemin, this.etat.prenom || 'moi'));
      await this.fichiers.ecrire(c.chemin, await this.telecharger(distant));
      this.majBase(c.chemin, distant);
      this.signaler('conflit', c.chemin, c.auteur);
    }
  }

  /**
   * Écrit la version d'un ami et dit ce qui a changé, pour que l'extension le surligne dans la note.
   * avantConnu : null = le fichier n'existait pas ici ; undefined = on lit l'ancienne version avant d'écrire.
   */
  async ecrireDistant(c, distant, avantConnu) {
    const contenu = await this.telecharger(distant);
    let avant = avantConnu;
    if (avant === undefined) avant = estTexte(c.chemin) ? versTexte((await this.fichiers.lire(c.chemin)) || new ArrayBuffer(0)) : '';
    await this.fichiers.ecrire(c.chemin, contenu);
    this.signalerModif(c, avant, estTexte(c.chemin) ? versTexte(contenu) : null);
  }

  signalerModif(c, avant, apres) {
    const lignes = apres === null ? { lignes: [], ajouts: 0, suppressions: 0 } : lignesModifiees(avant || '', apres);
    this.signaler('modifie-par', c.chemin, { auteur: c.auteur || null, auteurId: c.auteurId || null, le: c.le || Date.now(), nouveau: avant === null, texte: apres !== null, ...lignes });
  }

  majBase(chemin, hash) {
    if (hash === null) delete this.etat.bases[chemin];
    else this.etat.bases[chemin] = hash;
  }

  /** Envoie les changements locaux. Renvoie le nombre d'écritures refusées car périmées. */
  async envoyer() {
    let refus = await this.envoyerDossiers(false);
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
    this.suppressionsFichiers = 0;
    if (!this.suppressionsAutorisees && disparus.length > 20 && disparus.length > total / 2) {
      this.suppressionsFichiers = disparus.length;
      this.signaler('garde-fou', disparus.length);
      return refus;
    }
    for (const p of disparus) {
      if ((await this.valider(p, null, this.etat.bases[p])) === 409) { refus++; continue; }
      delete this.etat.bases[p];
      delete this.etat.cache[p];
    }
    return refus + await this.envoyerDossiers(true);
  }

  async envoyerDossiers(supprimer) {
    if (!this.fichiers.listerDossiers || this.dossiersDisponibles === false) return 0;
    const presents = new Set(this.fichiers.listerDossiers().filter((p) => !this.ignorer(p)));
    const connus = Object.keys(this.etat.dossiers).filter((p) => !this.ignorer(p));
    const chemins = supprimer ? connus.filter((p) => !presents.has(p)) : [...presents].filter((p) => !Object.hasOwn(this.etat.dossiers, p));
    if (supprimer) this.suppressionsDossiers = 0;
    if (supprimer && !this.suppressionsAutorisees && chemins.length > 20 && chemins.length > connus.length / 2) {
      this.suppressionsDossiers = chemins.length;
      this.signaler('garde-fou', chemins.length, 'dossiers');
      return 0;
    }
    chemins.sort((a, b) => supprimer ? b.split('/').length - a.split('/').length : a.split('/').length - b.split('/').length);
    let refus = 0;
    for (const chemin of chemins) {
      try {
        const reponse = await this.api('POST', `${this.racine()}/dossiers`, { chemin, supprime: supprimer, baseRev: this.etat.dossiers[chemin] ?? null });
        if (reponse.statut === 409) { refus++; this.signaler('dossier-en-attente', chemin); continue; }
        const resultat = await reponse.json();
        if (supprimer) delete this.etat.dossiers[chemin]; else this.etat.dossiers[chemin] = resultat.rev;
        this.signaler('dossier-ok', chemin);
        this.dossiersDisponibles = true;
      } catch (erreur) {
        if (erreur.statut === 404) { this.dossiersDisponibles = false; this.signaler('dossiers-indisponibles'); break; }
        throw erreur;
      }
    }
    return refus;
  }
}

/* ---------- Intégration Obsidian ---------- */

// Doit rester égale à la version de manifest.json (un test le vérifie).
const VERSION = '0.1.7';
// Première version qui sait créer et supprimer des dossiers : en dessous, un ami voit les fichiers partir mais pas les dossiers.
const VERSION_DOSSIERS = '0.1.5';

function comparerVersions(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  return 0;
}

const PAR_DEFAUT = { serveur: '', coffreId: '', nomCoffre: '', jeton: '', prenom: '', derniereRev: 0, bases: {}, cache: {}, dossiers: {}, enAttente: {}, aVoir: {}, dossiersIgnores: '', enPause: false, derniereSynchro: null };

function expliquerErreur(erreur) {
  if ([401, 403].includes(erreur?.statut)) return 'Accès refusé. Ton accès au coffre a peut-être été retiré : demande une nouvelle invitation.';
  if (erreur?.statut === 429) return 'Trop de tentatives. Patiente une minute avant de réessayer.';
  if (erreur?.statut === 413) return 'Un fichier dépasse la taille autorisée par le serveur. Réduis sa taille ou exclus son dossier, puis réessaie.';
  if (erreur?.statut >= 500) return 'Le serveur rencontre un problème. Tes notes restent sur cet appareil ; tu peux réessayer plus tard.';
  if (erreur?.reseau) return 'Le serveur ne répond pas. Vérifie ta connexion Internet et l’adresse du serveur, puis réessaie. Tes notes locales sont conservées.';
  const detail = String(erreur?.message || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  return `La synchronisation a rencontré un problème${detail ? ' : ' + detail : ''}. Le serveur répond ; tes notes locales sont conservées.`;
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
  const dossiersAbsents = new Set();
  const estDossier = (f) => !!(O.TFolder && f instanceof O.TFolder);
  const verifier = (p) => { if (dansConfiguration(p, vault.configDir)) throw new Error('Le dossier de configuration du coffre n’est pas partagé.'); };
  const trouver = (p) => { if (dansConfiguration(p, vault.configDir)) return null; const f = vault.getAbstractFileByPath(p); return f instanceof O.TFile ? f : null; };
  async function dossiers(p) {
    const parts = p.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const d = parts.slice(0, i).join('/');
      const f = vault.getAbstractFileByPath(d);
      if (f && !estDossier(f)) throw new Error('Un fichier empêche la création du dossier : ' + d);
      if (dossiersAbsents.has(d)) {
        if (!await vault.adapter.exists(d)) await vault.adapter.mkdir(d);
        dossiersAbsents.delete(d);
      } else if (!f) {
        const existe = await vault.adapter.exists(d);
        const sosie = existe ? sosieParCasse(d, true) : null;
        if (sosie) await renommerCasse(sosie, d);
        else if (!existe) await vault.createFolder(d);
      }
    }
  }
  // Disque insensible à la casse (Windows, macOS) : « S3/PAPP3 » et « S3/PApp3 » désignent le même dossier pour le
  // système mais deux chemins pour Cordée. Plutôt que d'échouer, ou d'écrire dans l'un puis de supprimer l'autre,
  // on met l'existant à la casse du serveur, qui fait foi. Sur un disque sensible à la casse, exists() reste faux : rien à faire.
  function sosieParCasse(chemin, dossier) {
    const bas = chemin.toLowerCase();
    return (vault.getAllLoadedFiles?.() || []).find((f) => f.path !== chemin && f.path?.toLowerCase() === bas && estDossier(f) === dossier) || null;
  }
  async function renommerCasse(element, vers) {
    try { await vault.rename(element, vers); }
    catch { // certains systèmes refusent un renommage qui ne change que la casse : on passe par un nom intermédiaire
      const provisoire = vers + '.cordee-casse';
      await vault.rename(element, provisoire);
      await vault.rename(vault.getAbstractFileByPath(provisoire), vers);
    }
  }
  return {
    invaliderDossier: (p) => dossiersAbsents.delete(p),
    lister: () => vault.getFiles().filter((f) => !dansConfiguration(f.path, vault.configDir)).map((f) => ({ chemin: f.path, mtime: f.stat.mtime, taille: f.stat.size })),
    listerDossiers: () => (vault.getAllLoadedFiles?.() || []).filter((f) => estDossier(f) && f.path && f.path !== '/' && !dansConfiguration(f.path, vault.configDir) && !dossiersAbsents.has(f.path)).map((f) => f.path),
    creerDossier: async (p) => { verifier(p); await dossiers(p + '/fichier'); },
    supprimerDossierVide: async (p) => {
      verifier(p);
      if (!p || p === '/') throw new Error('La racine du coffre reste locale.');
      try {
        // Le cache Obsidian ne voit pas tous les fichiers cachés. La vérification
        // physique et rmdir(false) empêchent toute suppression récursive, même en course.
        const contenu = await vault.adapter.list(p);
        // Les fichiers que le système crée tout seul (miniatures, icônes de dossier) ne comptent pas : sans cela,
        // un dossier supprimé chez l'ami resterait chez toi, vide mais bien là, à cause d'un « Thumbs.db ».
        const parasites = contenu.files.filter((f) => /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(f));
        if (contenu.files.length > parasites.length || contenu.folders.length) return false;
        for (const f of parasites) await vault.adapter.remove(f);
        await vault.adapter.rmdir(p, false);
        dossiersAbsents.add(p);
        return true;
      } catch {
        if (!await vault.adapter.exists(p)) { dossiersAbsents.add(p); return true; }
        return false;
      }
    },
    lire: async (p) => { const f = trouver(p); return f ? vault.readBinary(f) : null; },
    ecrire: async (p, buf) => {
      verifier(p);
      let f = trouver(p);
      if (!f) {
        await dossiers(p);
        f = trouver(p); // renommer un dossier à la bonne casse y a déjà amené le fichier
        const sosie = !f && (await vault.adapter.exists(p)) ? sosieParCasse(p, false) : null;
        if (sosie) { await renommerCasse(sosie, p); f = trouver(p); }
      }
      if (f) { await vault.modifyBinary(f, buf); return; }
      try { await vault.createBinary(p, buf); }
      catch (e) { if (await vault.adapter.exists(p)) await vault.adapter.writeBinary(p, buf); else throw e; } // présent sur le disque mais pas encore dans l'index d'Obsidian
    },
    supprimer: async (p) => { verifier(p); const f = trouver(p); if (f) await vault.trash(f, false); }, // corbeille locale du coffre : récupérable
    renommer: async (de, vers) => { verifier(de); verifier(vers); const f = trouver(de); if (f) await vault.rename(f, vers); },
  };
}

let InvitationModal, ActiviteModal, RevisionModal, ProfilModal, ReglagesCordee, PanneauCordee;

class CordeePlugin extends (O ? O.Plugin : Object) {
  async onload() {
    this.etat = Object.assign({}, PAR_DEFAUT, await this.loadData());
    if (this.connecte()) this.memoriserPreferences();
    this.phase = 'pret';
    this.derniereErreur = '';
    this.abonnesStatut = new Set();
    this.fichiersTropGros = new Set();
    this.fichiersBloques = new Map();
    this.dossiersEnAttente = new Set();
    this.etat.aVoir = this.nettoyerAVoir(this.etat.aVoir);
    this.barre = this.addStatusBarItem();
    // La barre d'état ouvre le panneau : c'est là qu'on regarde quand quelque chose a bougé.
    this.barre.addClass?.('mod-clickable');
    this.barre.onClickEvent?.(() => new PanneauCordee(this.app, this).open());
    this.moteur = this.creerMoteur();
    this.afficher('');
    const surlignage = creerExtensionSurlignage(this);
    if (surlignage) this.registerEditorExtension(surlignage);
    if (globalThis.document?.head) {
      this.styleMarques = document.head.createEl ? document.head.createEl('style', { attr: { id: 'cordee-marques' } }) : null;
      this.rafraichirMarques();
    }
    this.addSettingTab(new ReglagesCordee(this.app, this));
    O.addIcon('cordee-logo', ICONE_CORDEE);
    this.addRibbonIcon('cordee-logo', 'Cordée — ouvrir le partage', () => new PanneauCordee(this.app, this).open());
    this.addCommand({ id: 'ouvrir', name: 'Ouvrir le panneau de partage', callback: () => new PanneauCordee(this.app, this).open() });
    this.addCommand({ id: 'synchroniser', name: 'Synchroniser maintenant', callback: () => this.lancer({ forcer: true }) });
    this.addCommand({ id: 'confirmer-suppressions', name: 'Confirmer les suppressions en attente (aussi chez les amis)', callback: () => this.confirmerSuppressions() });
    this.addCommand({ id: 'pause', name: 'Mettre en pause ou reprendre la synchronisation', callback: () => this.mettreEnPause(!this.etat.enPause) });
    this.addCommand({ id: 'inviter', name: "Créer une invitation pour un ami", callback: () => this.inviter() });
    this.addCommand({ id: 'activite', name: 'Voir qui a modifié quoi', callback: () => new ActiviteModal(this.app, this).open() });
    this.addCommand({ id: 'marquer-vu', name: 'Marquer les modifications de cette note comme vues', callback: () => { const f = this.app.workspace.getActiveFile?.(); if (f) this.marquerVu(f.path); } });
    this.addCommand({ id: 'tout-vu', name: 'Tout marquer comme vu', callback: () => this.toutMarquerVu() });
    this.registerObsidianProtocolHandler('cordee', (params) => {
      const invitation = invitationValide(new URLSearchParams({ serveur: params.serveur || '', code: params.code || '' }));
      if (!invitation) { new O.Notice('Ce lien Cordée est incomplet. Demande une nouvelle invitation.'); return; }
      const panneau = new PanneauCordee(this.app, this);
      if (this.connecte()) new O.Notice('Ce coffre est déjà connecté. Ouvre un coffre vide pour rejoindre un autre groupe.');
      else panneau.reglages.form.invitation = 'obsidian://cordee?' + new URLSearchParams(invitation);
      panneau.open(); // Préremplit uniquement : rejoindre exige toujours une action de l'utilisateur.
    });

    this.app.workspace.onLayoutReady(() => {
      const plus_tard = (f) => { if (f?.path) this.moteur.fichiers.invaliderDossier(f.path); this.programmer(2000); };
      for (const ev of ['create', 'modify', 'delete', 'rename']) this.registerEvent(this.app.vault.on(ev, plus_tard));
      // Les marques « à voir » suivent un fichier renommé et disparaissent avec un fichier supprimé.
      this.registerEvent(this.app.vault.on('rename', (f, ancien) => { if (this.etat.aVoir[ancien]) { this.etat.aVoir[f.path] = this.etat.aVoir[ancien]; delete this.etat.aVoir[ancien]; this.rafraichirMarques(); } }));
      this.registerEvent(this.app.vault.on('delete', (f) => { if (this.etat.aVoir[f?.path]) { delete this.etat.aVoir[f.path]; this.rafraichirMarques(); } }));
      // Ouvrir la note retire le point de l'explorateur ; les lignes restent surlignées jusqu'à « Vu ».
      this.registerEvent(this.app.workspace.on('file-open', (f) => { const e = f && this.etat.aVoir[f.path]; if (e && !e.ouvert) { e.ouvert = true; this.rafraichirMarques(); } }));
      this.registerInterval(window.setInterval(() => this.lancer(), 5 * 60_000)); // filet de sécurité
      this.ecouter();
      this.lancer();
    });
  }

  onunload() { this.arret = true; clearTimeout(this.minuteur); clearTimeout(this.minuteurMarques); this.abonnesStatut.clear(); this.styleMarques?.remove?.(); }

  /* ---------- Ce que les amis ont changé et que tu n'as pas encore vu ---------- */

  nettoyerAVoir(aVoir) {
    const propre = {};
    const limite = Date.now() - 7 * 24 * 3600_000; // au-delà d'une semaine, ce n'est plus une nouveauté
    for (const [chemin, e] of Object.entries(aVoir || {})) if (e && e.le > limite) propre[chemin] = e;
    return propre;
  }

  noterModif(chemin, info) {
    const avant = this.etat.aVoir[chemin];
    const auteurs = [...new Set([info.auteur || 'Un membre', ...(avant?.auteurs || [])])].slice(0, 4);
    this.etat.aVoir[chemin] = {
      auteurs,
      le: Math.max(info.le || 0, avant?.le || 0) || Date.now(),
      lignes: [...new Set([...(info.lignes || []), ...(avant?.lignes || [])])].slice(0, 400),
      ajouts: (avant?.ajouts || 0) + (info.ajouts || 0),
      suppressions: (avant?.suppressions || 0) + (info.suppressions || 0),
      nouveau: !!(avant?.nouveau || info.nouveau),
      texte: info.texte !== false,
      ouvert: false,
    };
    const cles = Object.keys(this.etat.aVoir);
    if (cles.length > 200) for (const c of cles.sort((a, b) => this.etat.aVoir[a].le - this.etat.aVoir[b].le).slice(0, cles.length - 200)) delete this.etat.aVoir[c];
    this.rafraichirMarques();
  }

  nombreAVoir() { return Object.keys(this.etat.aVoir || {}).length; }

  async marquerVu(chemin) {
    if (!this.etat.aVoir[chemin]) return;
    delete this.etat.aVoir[chemin];
    this.rafraichirMarques(0);
    try { await this.saveData(this.etat); } catch { /* sera enregistré à la prochaine synchro */ }
  }

  async toutMarquerVu() {
    this.etat.aVoir = {};
    this.rafraichirMarques(0);
    try { await this.saveData(this.etat); } catch { /* idem */ }
  }

  /** Met à jour le point dans l'explorateur, le surlignage des notes ouvertes et le panneau (regroupé, 150 ms). */
  rafraichirMarques(delai = 150) {
    clearTimeout(this.minuteurMarques);
    this.minuteurMarques = setTimeout(() => {
      if (this.arret) return;
      if (this.styleMarques) {
        this.styleMarques.textContent = Object.entries(this.etat.aVoir).filter(([, e]) => !e.ouvert).map(([chemin, e]) =>
          `.nav-file-title[data-path="${echapperCss(chemin)}"] .nav-file-title-content::after { content: ""; display: inline-block; width: 7px; height: 7px; margin-inline-start: 6px; border-radius: 50%; vertical-align: middle; background: ${couleurAuteur(e.auteurs?.[0])}; }`).join('\n');
      }
      if (this.effetRafraichir) this.app.workspace.iterateAllLeaves?.((leaf) => { const cm = leaf.view?.editor?.cm; if (cm?.dispatch) cm.dispatch({ effects: this.effetRafraichir.of(null) }); });
      this.afficher();
    }, delai);
  }

  /** Ouvre la note et place le curseur sur la première ligne modifiée par l'ami. */
  async ouvrirModif(chemin) {
    const e = this.etat.aVoir[chemin];
    await this.app.workspace.openLinkText(chemin, '', false);
    const vue = O.MarkdownView ? this.app.workspace.getActiveViewOfType?.(O.MarkdownView) : null;
    const editeur = vue?.file?.path === chemin ? vue.editor : null;
    if (!editeur || !e?.lignes?.length) return;
    const lignes = new Set(e.lignes);
    for (let n = 0; n < editeur.lineCount(); n++) {
      if (lignes.has(editeur.getLine(n))) { editeur.setCursor({ line: n, ch: 0 }); editeur.scrollIntoView({ from: { line: n, ch: 0 }, to: { line: n, ch: 0 } }, true); return; }
    }
  }

  connecte() { return !!(this.etat.serveur && this.etat.coffreId && this.etat.jeton); }

  memoriserPreferences() {
    // Préférences de cet appareil uniquement : aucun jeton, code ou contenu de coffre.
    try {
      globalThis.localStorage?.setItem(CLE_PREFERENCES, JSON.stringify({ serveur: this.etat.serveur, prenom: this.etat.prenom }));
    } catch { /* Un stockage indisponible ne doit pas empêcher de rejoindre. */ }
  }

  creerMoteur() {
    return new Moteur({
      etat: this.etat,
      sauver: () => this.saveData(this.etat),
      fichiers: fichiersObsidian(this.app),
      http: httpObsidian,
      ignorer: (p) => dansConfiguration(p, this.app.vault.configDir) || this.etat.dossiersIgnores.split(',').map((s) => s.trim()).filter(Boolean).some((d) => dansDossier(p, d)),
      signaler: (quoi, a, b) => {
        if (quoi === 'synchro') { this.phase = 'synchro'; this.derniereErreur = ''; this.sourceErreur = ''; this.fichiersTropGros.clear(); this.fichiersBloques.clear(); this.dossiersEnAttente.clear(); this.suppressionsBloquees = 0; }
        else if (quoi === 'ok') this.phase = 'ok';
        else if (quoi === 'erreur') this.signalerErreur(a, 'synchro');
        else if (quoi === 'conflit') new O.Notice(`Cordée : ${a} modifié aussi par ${b || 'un ami'}. Les deux versions sont gardées, vérifie la note.`, 10000);
        else if (quoi === 'garde-fou') this.annoncerGardeFou(a, b);
        else if (quoi === 'dossiers-indisponibles') new O.Notice('Cordée : ce serveur doit être mis à jour pour partager les dossiers vides. Les notes continuent à se synchroniser.', 10000);
        else if (quoi === 'dossier-conserve') new O.Notice(`Cordée : ${a} a été conservé car il contient encore des fichiers locaux.`, 10000);
        else if (quoi === 'dossier-en-attente') this.dossiersEnAttente.add(a);
        else if (quoi === 'dossier-ok') this.dossiersEnAttente.delete(a);
        else if (quoi === 'fichier-trop-gros') this.fichiersTropGros.add(a);
        else if (quoi === 'modifie-par') this.noterModif(a, b);
        else if (quoi === 'fichier-bloque') this.fichiersBloques.set(a, String(b?.message || b || '').replace(/\s+/g, ' ').slice(0, 120));
        this.afficher();
      },
    });
  }

  /** État résumé pour la pastille de couleur du panneau. */
  etatCourt() {
    if (!this.connecte() || this.etat.enPause) return 'pause';
    if (this.phase === 'synchro') return 'synchro';
    if (this.derniereErreur) return 'erreur';
    if (this.fichiersTropGros.size || this.fichiersBloques.size || this.suppressionsBloquees || this.dossiersEnAttente.size) return 'attention';
    return 'ok';
  }

  titreStatut() {
    if (!this.connecte()) return 'non connecté';
    if (this.phase === 'synchro') return this.etat.enPause ? 'fin de la synchronisation en cours…' : 'synchronisation…';
    if (this.etat.enPause) return 'en pause';
    if (this.derniereErreur) return 'connexion à vérifier';
    if (this.fichiersTropGros.size || this.fichiersBloques.size || this.suppressionsBloquees || this.dossiersEnAttente.size) return 'fichiers à vérifier';
    return this.etat.derniereSynchro ? 'à jour' : 'prêt';
  }

  /** Fichiers d'un ami qui n'ont pas pu être écrits ici : le reste se synchronise quand même. */
  /**
   * Plus de 20 éléments (et plus de la moitié du coffre) ont disparu d'un coup : par prudence rien n'est supprimé
   * chez les autres. Si c'est voulu, un bouton, une commande et le panneau permettent de le confirmer.
   */
  annoncerGardeFou(n, quoi) {
    this.suppressionsBloquees = n;
    const cle = `${quoi || 'fichiers'}:${n}`;
    if (cle === this.dernierGardeFou) return;
    this.dernierGardeFou = cle;
    const notice = new O.Notice(`Cordée : ${n} ${quoi === 'dossiers' ? 'dossiers' : 'fichiers'} ont disparu d’un coup de ce coffre. Par prudence, rien n’a été supprimé chez les autres. Si c’est voulu, confirme ci-dessous ; sinon restaure-les (corbeille du coffre) et rien ne sera supprimé.`, 0);
    const bouton = notice.noticeEl?.createEl?.('button', { text: 'Supprimer aussi chez les autres' });
    if (bouton) bouton.onclick = () => { notice.hide?.(); this.confirmerSuppressions(); };
  }

  async confirmerSuppressions() {
    if (!this.connecte() || !this.moteur.suppressionsEnAttente()) { new O.Notice('Aucune suppression en attente de confirmation.'); return; }
    this.moteur.autoriserSuppressions();
    this.dernierGardeFou = '';
    await this.lancer({ forcer: true });
  }

  /**
   * Avant la 0.1.5, l'extension ne sait ni créer ni supprimer de dossiers : un ami qui l'a gardée voit les fichiers
   * disparaître mais pas le dossier vide. On le dit une fois, avec les noms, plutôt que de laisser croire à un bug.
   */
  async verifierVersions() {
    if (!this.connecte() || this.arret) return;
    const t = Date.now();
    if (this.derniereVerifVersions && t - this.derniereVerifVersions < 30 * 60_000) return;
    this.derniereVerifVersions = t;
    try {
      const info = await (await this.moteur.api('GET', `/api/coffres/${this.etat.coffreId}`)).json();
      const retard = (info.membres || []).filter((m) => m.id !== info.moiId && (!m.version || comparerVersions(m.version, VERSION_DOSSIERS) < 0)).map((m) => m.nom);
      const cle = retard.join('|');
      if (retard.length && cle !== this.dernierRetardVersions) new O.Notice(`Cordée : à mettre à jour chez ${retard.join(', ')} (version d’avant les dossiers, ou inconnue). Tant que ce n’est pas fait, les fichiers arrivent mais les dossiers créés ou supprimés ici ne se mettent pas à jour chez eux.`, 20000);
      this.dernierRetardVersions = cle;
    } catch { /* simple information : ne doit jamais gêner la synchronisation */ }
  }

  texteBloques() {
    if (!this.fichiersBloques.size) return '';
    const [premier, raison] = [...this.fichiersBloques.entries()][0];
    const autres = this.fichiersBloques.size - 1;
    return `${this.fichiersBloques.size} fichier(s) reçus n’ont pas pu être écrits sur cet appareil (${premier}${autres ? ` et ${autres} autre(s)` : ''}${raison ? ' : ' + raison : ''}). Le reste continue de se synchroniser ; Cordée réessaie à chaque synchro.`;
  }

  afficher() {
    const aVoir = this.connecte() ? this.nombreAVoir() : 0;
    this.barre.setText(`Cordée : ${this.titreStatut()}${aVoir ? ` · ${aVoir} à voir` : ''}`);
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
    const resume = this.texteBloques();
    if (resume && resume !== this.dernierResumeBloques) new O.Notice('Cordée : ' + resume, 15000);
    this.dernierResumeBloques = resume;
    if (this.phase === 'ok') this.verifierVersions();
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
    Object.assign(this.etat, { serveur: serveur.replace(/\/$/, ''), coffreId: j.coffreId, nomCoffre: j.nom, jeton: j.jeton, prenom: corps.prenom, derniereRev: 0, bases: {}, cache: {}, dossiers: Object.create(null), enPause: false, derniereSynchro: null });
    await this.saveData(this.etat);
    this.memoriserPreferences();
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
    Object.assign(this.etat, { coffreId: '', nomCoffre: '', jeton: '', derniereRev: 0, bases: {}, cache: {}, dossiers: Object.create(null), enPause: false, derniereSynchro: null });
    await this.saveData(this.etat);
    this.afficher('');
  }
}

/**
 * Lignes apparues ou modifiées dans « apres » par rapport à « avant » (comptées comme un multi-ensemble).
 * Pas de limite de taille, contrairement à la comparaison détaillée : il s'agit seulement de savoir quoi surligner.
 * Les lignes vides ne sont pas retenues (elles se ressemblent toutes).
 */
function lignesModifiees(avant, apres) {
  const decouper = (t) => t === '' ? [] : t.replace(/\r\n/g, '\n').split('\n');
  const restantes = new Map();
  for (const l of decouper(avant)) restantes.set(l, (restantes.get(l) || 0) + 1);
  const nouvelles = new Set();
  let ajouts = 0;
  for (const l of decouper(apres)) {
    const n = restantes.get(l) || 0;
    if (n > 0) { restantes.set(l, n - 1); continue; }
    ajouts++;
    if (l.trim() && nouvelles.size < 400) nouvelles.add(l);
  }
  let suppressions = 0;
  for (const n of restantes.values()) suppressions += n;
  return { lignes: [...nouvelles], ajouts, suppressions };
}

// Une couleur stable par personne, prise dans les couleurs du thème Obsidian (clair comme sombre).
const COULEURS_AUTEURS = ['var(--color-blue)', 'var(--color-green)', 'var(--color-orange)', 'var(--color-purple)', 'var(--color-cyan)', 'var(--color-pink)'];
function couleurAuteur(nom) {
  let h = 0;
  for (const car of String(nom || '')) h = (h * 31 + car.codePointAt(0)) >>> 0;
  return COULEURS_AUTEURS[h % COULEURS_AUTEURS.length];
}

function ilYa(date, maintenant = Date.now()) {
  const s = Math.max(0, Math.round((maintenant - date) / 1000));
  if (s < 60) return 'à l’instant';
  const m = Math.round(s / 60); if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `il y a ${h} h`;
  const j = Math.round(h / 24); if (j < 7) return `il y a ${j} j`;
  return new Date(date).toLocaleDateString('fr-FR');
}

const nomFichier = (chemin) => chemin.split('/').pop();
const dossierDe = (chemin) => chemin.includes('/') ? chemin.slice(0, chemin.lastIndexOf('/')) : '';
// Valeur d'attribut CSS entre guillemets : seuls le guillemet, l'antislash et les retours à la ligne gênent.
const echapperCss = (s) => String(s).replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ');

const resumeModif = (e) => {
  const qui = (e.auteurs || []).join(', ') || 'Un membre';
  const lignes = (n, signe) => n ? `${signe}${n} ligne${n > 1 ? 's' : ''}` : '';
  const quoi = e.nouveau ? (e.texte === false ? 'a ajouté ce fichier' : 'a ajouté cette note')
    : e.texte === false ? 'a modifié ce fichier'
    : [lignes(e.ajouts, '+'), lignes(e.suppressions, '−')].filter(Boolean).join(' ') || 'a modifié la note';
  return `${qui} · ${quoi} · ${ilYa(e.le)}`;
};

/**
 * Surlignage dans l'éditeur (modes Source et Aperçu en direct) des lignes qu'un ami vient de modifier,
 * à sa couleur, avec une étiquette « Prénom · +3 −1 lignes · il y a 5 min » et un bouton « Vu ».
 * Les lignes sont reconnues par leur texte : si tu retouches une ligne, elle n'est plus surlignée.
 * Renvoie null si CodeMirror n'est pas disponible (tests, très vieil Obsidian) : le reste de l'extension marche sans.
 */
function creerExtensionSurlignage(plugin) {
  let V, S;
  try { V = require('@codemirror/view'); S = require('@codemirror/state'); } catch { return null; }
  if (!V?.ViewPlugin || !V?.Decoration || !V?.WidgetType || !S?.StateEffect || !O?.editorInfoField) return null;
  const rafraichir = S.StateEffect.define();
  plugin.effetRafraichir = rafraichir;

  class Etiquette extends V.WidgetType {
    constructor(texte, chemin, couleur) { super(); this.texte = texte; this.chemin = chemin; this.couleur = couleur; }
    eq(autre) { return autre.texte === this.texte && autre.chemin === this.chemin; }
    toDOM() {
      const el = document.createElement('span');
      el.className = 'cordee-etiquette';
      el.style.setProperty('--cordee-couleur', this.couleur);
      el.appendChild(document.createTextNode(this.texte));
      const vu = document.createElement('button');
      vu.className = 'cordee-etiquette-vu';
      vu.type = 'button';
      vu.textContent = 'Vu';
      vu.setAttribute('aria-label', 'Marquer ces modifications comme vues');
      vu.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); plugin.marquerVu(this.chemin); });
      el.appendChild(vu);
      return el;
    }
    ignoreEvent() { return true; }
  }

  const construire = (view) => {
    const chemin = view.state.field(O.editorInfoField, false)?.file?.path;
    const entree = chemin ? plugin.etat.aVoir?.[chemin] : null;
    if (!entree?.lignes?.length) return V.Decoration.none;
    const lignes = new Set(entree.lignes);
    const couleur = couleurAuteur(entree.auteurs?.[0]);
    const decos = [];
    const doc = view.state.doc;
    // L'étiquette va sur la première ligne modifiée de la note, même hors de l'écran.
    for (let n = 1; n <= Math.min(doc.lines, 20000); n++) {
      const l = doc.line(n);
      if (l.text.trim() && lignes.has(l.text)) { decos.push(V.Decoration.widget({ widget: new Etiquette(resumeModif(entree), chemin, couleur), side: 1 }).range(l.to)); break; }
    }
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const l = doc.lineAt(pos);
        if (l.text.trim() && lignes.has(l.text)) decos.push(V.Decoration.line({ attributes: { class: 'cordee-ligne-modifiee', style: `--cordee-couleur: ${couleur}` } }).range(l.from));
        pos = l.to + 1;
      }
    }
    return V.Decoration.set(decos, true);
  };

  return V.ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = construire(view); }
    update(u) {
      if (u.docChanged || u.viewportChanged || u.transactions.some((t) => t.effects.some((e) => e.is(rafraichir)))) this.decorations = construire(u.view);
    }
  }, { decorations: (v) => v.decorations });
}

function calculerDiff(avant, apres) {
  if (typeof avant !== 'string' || typeof apres !== 'string' || avant.length > 256 * 1024 || apres.length > 256 * 1024) return { limite: true, lignes: [] };
  const decouper = (texte) => texte === '' ? [] : texte.replace(/\r\n/g, '\n').split('\n');
  const a = decouper(avant), b = decouper(apres);
  if (a.length > 600 || b.length > 600 || a.length * b.length > 250_000) return { limite: true, lignes: [] };
  const largeur = b.length + 1, longueurs = new Uint16Array((a.length + 1) * largeur);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    longueurs[i * largeur + j] = a[i] === b[j] ? 1 + longueurs[(i + 1) * largeur + j + 1] : Math.max(longueurs[(i + 1) * largeur + j], longueurs[i * largeur + j + 1]);
  }
  const lignes = []; let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { lignes.push({ type: 'contexte', avant: i + 1, apres: j + 1, texte: a[i] }); i++; j++; }
    else if (i < a.length && (j === b.length || longueurs[(i + 1) * largeur + j] >= longueurs[i * largeur + j + 1])) { lignes.push({ type: 'suppression', avant: i + 1, apres: null, texte: a[i++] }); }
    else { lignes.push({ type: 'ajout', avant: null, apres: j + 1, texte: b[j++] }); }
  }
  return { limite: false, lignes };
}

function premierBlocModifie(diff, apres) {
  const debut = diff.lignes.findIndex((ligne) => ligne.type !== 'contexte');
  if (debut < 0 || diff.limite) return null;
  let fin = debut;
  while (fin + 1 < diff.lignes.length && diff.lignes[fin + 1].type !== 'contexte') fin++;
  const lignesApres = apres.replace(/\r\n/g, '\n').split('\n');
  const ajouts = diff.lignes.slice(debut, fin + 1).filter((ligne) => ligne.apres !== null);
  const suivant = diff.lignes.slice(fin + 1).find((ligne) => ligne.apres !== null);
  const premiere = Math.max(0, Math.min(lignesApres.length - 1, (ajouts[0]?.apres || suivant?.apres || lignesApres.length) - 1));
  const derniere = ajouts.length ? ajouts[ajouts.length - 1].apres - 1 : premiere;
  return { de: { line: premiere, ch: 0 }, a: { line: derniere, ch: lignesApres[derniere]?.length || 0 } };
}

function boutonCordee(c, texte, action, options = {}) {
  const bouton = c.createEl('button', { text: texte, cls: 'cordee-bouton ' + (options.cls || ''), attr: { type: 'button', 'aria-label': options.label || texte, ...options.attr } });
  bouton.onclick = () => { if (!bouton.disabled) return action(); };
  return bouton;
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
      const memeConnexion = () => !this.plugin.arret && this.plugin.etat.coffreId === coffreId && this.plugin.etat.jeton === jeton;
      const actif = () => !this.ferme && this.tour === tour && memeConnexion();
      c.empty();
      c.createEl('h3', { text: 'Mon profil' });
      c.createEl('p', { text: 'Ta photo sera visible par les membres de ce coffre, à côté de tes changements. Elle est recadrée en carré et ses métadonnées sont retirées sur cet appareil.' });
      const etat = c.createEl('p', { text: 'Chargement du profil…', cls: 'cordee-details', attr: { role: 'status', 'aria-live': 'polite' } });
      try {
        const info = await (await this.plugin.moteur.api('GET', `/api/coffres/${coffreId}`)).json();
        if (!actif()) return;
        const trouve = info.membres?.find((membre) => membre.id && membre.id === info.moiId);
        if (!trouve) { etat.setText('Le profil demande une mise à jour du serveur Cordée. La synchronisation reste disponible.'); return; }
        const moi = { ...trouve };
        let actuel = avatarValide(moi.avatar), choix = null, lecture = 0, occupe = false;
        const apercu = c.createEl('div', { cls: 'cordee-profil-apercu' });
        const montrer = (avatar) => { apercu.empty(); afficherAvatar(apercu, moi.nom, avatar); apercu.createEl('span', { text: moi.nom }); };
        montrer(actuel);
        let saisieNom = moi.nom, champNom, enregistrerNom;
        new O.Setting(c).setName('Nom affiché').setDesc('De 1 à 60 caractères. Visible par les membres de ce coffre et dans ton activité.').addText((champ) => {
          champNom = champ;
          champ.setValue(saisieNom).onChange((valeur) => { saisieNom = valeur; });
          champ.inputEl.maxLength = 60;
        }).addButton((b) => { enregistrerNom = b; b.setButtonText('Enregistrer le nom').onClick(async () => {
          if (!actif() || occupe) return;
          const nom = saisieNom.trim();
          if (!nom || nom.length > 60) { etat.setText('Le nom affiché doit contenir de 1 à 60 caractères.'); return; }
          occupe = true; boutons(); etat.setText('Enregistrement du nom…');
          let profil;
          try {
            profil = await (await this.plugin.moteur.api('PUT', `/api/coffres/${coffreId}/profil`, { nom })).json();
          } catch (erreur) {
            if (actif()) etat.setText(erreur.statut === 404 ? 'Ce serveur ne permet pas encore de modifier le profil. Mets le serveur Cordée à jour.' : erreur.statut === 400 ? 'Nom refusé par le serveur. Utilise de 1 à 60 caractères, puis réessaie.' : 'Nom non enregistré. ' + expliquerErreur(erreur));
          }
          if (profil && memeConnexion()) {
            this.plugin.etat.prenom = profil.nom;
            let sauvegardeLocale = true;
            try { await this.plugin.saveData(this.plugin.etat); } catch { sauvegardeLocale = false; }
            if (memeConnexion()) {
              try { await this.plugin.memoriserPreferences(); } catch { sauvegardeLocale = false; }
              this.plugin.afficher();
            }
            if (actif()) {
              moi.nom = profil.nom; saisieNom = profil.nom; champNom.setValue(profil.nom); montrer(choix || actuel);
              etat.setText(sauvegardeLocale ? 'Nom enregistré. Les membres le verront dans ton activité.' : 'Nom mis à jour sur le serveur et dans cette session, mais la sauvegarde locale a échoué. Il faudra peut-être le ressaisir après redémarrage.');
            }
          }
          if (actif()) { occupe = false; boutons(); }
        }); });
        c.createEl('label', { text: 'Choisir une photo (JPEG, PNG ou WebP, 10 Mo maximum)', cls: 'cordee-details' });
        const fichier = c.createEl('input', { type: 'file', cls: 'cordee-choix-photo', attr: { accept: 'image/jpeg,image/png,image/webp', 'aria-label': 'Choisir ma photo de profil' } });
        let enregistrer, retirer;
        const boutons = () => { enregistrer?.setDisabled(occupe || !choix); retirer?.setDisabled(occupe || !actuel); enregistrerNom.setDisabled(occupe); champNom.inputEl.disabled = occupe; fichier.disabled = occupe; };
        const sauver = async (avatar) => {
          if (!actif() || occupe) return;
          occupe = true; ++lecture; boutons(); etat.setText('Enregistrement du profil…');
          try {
            const profil = await (await this.plugin.moteur.api('PUT', `/api/coffres/${coffreId}/profil`, { avatar })).json();
            if (!actif()) return;
            if (typeof profil.nom === 'string') moi.nom = profil.nom;
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

  RevisionModal = class extends O.Modal {
    constructor(app, plugin, revision, membre) { super(app); this.plugin = plugin; this.revision = revision; this.membre = membre; }
    async onOpen() {
      const c = this.contentEl, p = this.plugin;
      this.ferme = false; const tour = this.tour = (this.tour || 0) + 1;
      const coffreId = p.etat.coffreId, jeton = p.etat.jeton;
      const actif = () => !this.ferme && this.tour === tour && !p.arret && p.etat.coffreId === coffreId && p.etat.jeton === jeton;
      this.modalEl?.classList.add('cordee-tableau-modal');
      c.empty(); c.createEl('div', { text: 'COMPARAISON', cls: 'cordee-surtitre' });
      const titre = c.createEl('h2', { text: `Révision ${this.revision}`, cls: 'cordee-titre' });
      const zone = c.createEl('div', { text: 'Chargement des deux versions…', cls: 'cordee-details', attr: { role: 'status' } });
      try {
        const r = await (await p.moteur.api('GET', `/api/coffres/${coffreId}/revisions/${this.revision}`)).json();
        if (!actif()) return;
        const ch = r.changement;
        titre.setText(ch.chemin); zone.empty();
        const auteur = zone.createEl('div', { cls: 'cordee-personne cordee-revision-auteur' });
        afficherAvatar(auteur, ch.auteur, this.membre?.id === ch.auteurId ? this.membre.avatar : null);
        auteur.createEl('span', { text: `${ch.auteur || 'Membre'} · ${new Date(ch.le).toLocaleString('fr-FR')} · révision ${ch.rev}` });
        let diff = null;
        if (r.raison) {
          zone.createEl('p', { text: r.raison === 'dossier' ? 'Ce changement concerne un dossier. Il n’y a pas de texte à comparer.' : r.raison === 'volumineux' ? 'Cette version dépasse la limite de comparaison de 256 Ko. Le fichier reste disponible dans le coffre.' : r.raison === 'indisponible' ? 'Une version historique manque sur le serveur. Aucune différence approximative n’est présentée.' : 'Ce fichier est une image, un PDF ou un autre fichier binaire. La comparaison ligne par ligne est réservée aux notes texte.', cls: 'cordee-vide' });
        } else {
          diff = calculerDiff(r.avant ?? '', r.apres ?? '');
          if (diff.limite) zone.createEl('p', { text: 'Cette note est trop longue pour une comparaison détaillée sur cet appareil. Aucune sélection automatique ne sera appliquée.', cls: 'cordee-vide' });
          else {
            const ajouts = diff.lignes.filter((l) => l.type === 'ajout').length, suppressions = diff.lignes.filter((l) => l.type === 'suppression').length;
            const resume = zone.createEl('div', { cls: 'cordee-diff-resume' });
            resume.createEl('span', { text: `+${ajouts} ajout${ajouts > 1 ? 's' : ''}`, cls: 'cordee-compte-ajout' });
            resume.createEl('span', { text: `−${suppressions} suppression${suppressions > 1 ? 's' : ''}`, cls: 'cordee-compte-suppression' });
            if (!ajouts && !suppressions) zone.createEl('p', { text: 'Aucune différence textuelle entre ces deux versions.', cls: 'cordee-vide' });
            else {
              zone.createEl('p', { text: 'Rouge : version précédente. Vert : version enregistrée par ce membre.', cls: 'cordee-details' });
              const tableau = zone.createEl('div', { cls: 'cordee-diff', attr: { role: 'table', 'aria-label': 'Différences entre les versions' } });
              let interruption = false;
              diff.lignes.forEach((ligne, index) => {
                const proche = ligne.type !== 'contexte' || diff.lignes.slice(Math.max(0, index - 3), index + 4).some((l) => l.type !== 'contexte');
                if (!proche) { if (!interruption) tableau.createEl('div', { text: '⋯ lignes inchangées ⋯', cls: 'cordee-diff-coupure' }); interruption = true; return; }
                interruption = false;
                const rangee = tableau.createEl('div', { cls: `cordee-diff-ligne cordee-diff-${ligne.type}`, attr: { role: 'row' } });
                rangee.createEl('span', { text: ligne.avant === null ? '' : String(ligne.avant), cls: 'cordee-diff-numero', attr: { role: 'cell', 'aria-label': 'Ligne précédente' } });
                rangee.createEl('span', { text: ligne.apres === null ? '' : String(ligne.apres), cls: 'cordee-diff-numero', attr: { role: 'cell', 'aria-label': 'Ligne suivante' } });
                rangee.createEl('span', { text: ligne.type === 'ajout' ? '+' : ligne.type === 'suppression' ? '−' : ' ', cls: 'cordee-diff-signe', attr: { role: 'cell' } });
                rangee.createEl('code', { text: ligne.texte.length > 4000 ? ligne.texte.slice(0, 4000) + '… [ligne abrégée]' : ligne.texte || ' ', attr: { role: 'cell' } });
              });
            }
          }
        }
        const retour = zone.createEl('p', { cls: 'cordee-details', attr: { role: 'status', 'aria-live': 'polite' } });
        if (!ch.supprime && ch.type !== 'dossier') boutonCordee(zone, 'Ouvrir la note', async () => {
          if (!actif()) return;
          try {
            await this.app.workspace.openLinkText(ch.chemin, '', false);
            if (!actif()) return;
            const vue = O.MarkdownView ? this.app.workspace.getActiveViewOfType?.(O.MarkdownView) : null;
            const editeur = vue?.file?.path === ch.chemin ? vue.editor : null;
            const bloc = diff && typeof r.apres === 'string' ? premierBlocModifie(diff, r.apres) : null;
            if (bloc && editeur?.getValue() === r.apres) { editeur.setSelection(bloc.de, bloc.a); editeur.scrollIntoView?.({ from: bloc.de, to: bloc.a }, true); retour.setText('Premier bloc modifié sélectionné dans la note.'); }
            else retour.setText('Note ouverte. La sélection est disponible seulement si son texte correspond exactement à cette version historique.');
          } catch { if (actif()) retour.setText('Impossible d’ouvrir cette note sur cet appareil. La comparaison historique reste disponible.'); }
        });
      } catch (erreur) { if (actif()) zone.setText(erreur.statut === 404 ? 'Cette comparaison n’est pas disponible sur ce serveur. Mets le serveur Cordée à jour.' : expliquerErreur(erreur)); }
    }
    onClose() { this.ferme = true; ++this.tour; this.contentEl.empty(); }
  };

  class TableauActivite {
    constructor(app, plugin, c, configurer) {
      this.app = app; this.plugin = plugin; this.c = c; this.coffreId = plugin.etat.coffreId; this.jeton = plugin.etat.jeton; this.filtre = null; this.comptes = new Map();
      c.empty();
      const tableau = c.createEl('div', { cls: 'cordee-tableau' });
      const entete = tableau.createEl('div', { cls: 'cordee-tableau-entete' });
      const titres = entete.createEl('div');
      titres.createEl('div', { text: 'CORDÉE', cls: 'cordee-surtitre' });
      titres.createEl('h2', { text: `Coffre partagé : ${plugin.etat.nomCoffre || 'Notre coffre'}`, cls: 'cordee-titre' });
      const commandes = entete.createEl('div', { cls: 'cordee-commandes' });
      boutonCordee(commandes, 'Mon profil', () => new ProfilModal(app, plugin).open(), { cls: 'cordee-bouton-discret' });
      boutonCordee(commandes, 'Inviter', () => plugin.inviter(), { label: 'Créer une invitation', cls: 'cordee-bouton-principal' });
      if (configurer) boutonCordee(commandes, 'Configurer', configurer, { cls: 'cordee-bouton-discret' });
      const etat = tableau.createEl('div', { cls: 'cordee-tableau-etat' });
      const statut = etat.createEl('span', { cls: 'cordee-statut', attr: { role: 'status' } });
      const pause = boutonCordee(etat, '', () => plugin.mettreEnPause(!plugin.etat.enPause), { label: 'Pause ou reprise', cls: 'cordee-bouton-discret' });
      boutonCordee(etat, 'Synchroniser', () => plugin.lancer({ forcer: true }), { cls: 'cordee-bouton-discret' });
      const attention = tableau.createEl('p', { cls: 'cordee-attention', attr: { role: 'status' } });
      const voir = tableau.createEl('div', { cls: 'cordee-section-titre' });
      this.titreAVoir = voir.createEl('h3', { text: 'À voir' });
      this.boutonToutVu = boutonCordee(voir, 'Tout marquer comme vu', () => plugin.toutMarquerVu(), { cls: 'cordee-bouton-discret' });
      this.aVoirEl = tableau.createEl('div', { cls: 'cordee-a-voir' });
      this.desabonner = plugin.abonnerStatut(() => {
        this.afficherAVoir();
        statut.setText(plugin.titreStatut()); statut.setAttribute('data-etat', plugin.etatCourt()); pause.setText(plugin.etat.enPause ? 'Reprendre' : 'Mettre en pause');
        pause.setAttribute('aria-label', plugin.etat.enPause ? 'Reprendre' : 'Mettre en pause');
        attention.setText(plugin.derniereErreur || plugin.texteBloques?.() || (plugin.suppressionsBloquees ? `${plugin.suppressionsBloquees} suppressions attendent ta confirmation (commande « Confirmer les suppressions en attente »).` : plugin.fichiersTropGros.size ? `${plugin.fichiersTropGros.size} fichier(s) de plus de 50 Mo n’ont pas été envoyés.` : '')); attention.hidden = !attention.textContent;
      });
      const section = tableau.createEl('div', { cls: 'cordee-section-titre' });
      section.createEl('h3', { text: 'Les membres' }); this.nombre = section.createEl('span', { cls: 'cordee-details' });
      this.membresEl = tableau.createEl('div', { cls: 'cordee-collegues', attr: { 'aria-label': 'Filtrer par membre' } });
      const activite = tableau.createEl('div', { cls: 'cordee-section-titre' });
      this.titreActivite = activite.createEl('h3', { text: 'Derniers changements' });
      boutonCordee(activite, 'Actualiser', () => this.charger(), { cls: 'cordee-bouton-discret' });
      this.information = tableau.createEl('p', { cls: 'cordee-details' });
      this.zone = tableau.createEl('div', { cls: 'cordee-fichiers', attr: { 'aria-live': 'polite' } });
      this.chargement = this.charger();
    }
    actif() { return !this.detruit && !this.plugin.arret && this.plugin.etat.coffreId === this.coffreId && this.plugin.etat.jeton === this.jeton; }
    /** Notes modifiées par les amis depuis ta dernière visite : un clic ouvre la note sur la modification. */
    afficherAVoir() {
      const p = this.plugin, zone = this.aVoirEl;
      if (!zone || this.detruit) return;
      const entrees = Object.entries(p.etat.aVoir || {}).sort((a, b) => b[1].le - a[1].le);
      const cle = JSON.stringify(entrees.map(([c, e]) => [c, e.le, e.ouvert, e.ajouts]));
      if (cle === this.cleAVoir) return; // le statut change souvent : on ne reconstruit que si la liste change
      this.cleAVoir = cle;
      zone.empty();
      this.boutonToutVu.hidden = !entrees.length;
      this.titreAVoir.setText(entrees.length ? `À voir (${entrees.length})` : 'À voir');
      if (!entrees.length) { zone.createEl('p', { text: 'Rien de nouveau : tu as tout vu.', cls: 'cordee-vide' }); return; }
      for (const [chemin, e] of entrees.slice(0, 30)) {
        const ligne = zone.createEl('div', { cls: 'cordee-a-voir-ligne' + (e.ouvert ? '' : ' cordee-non-ouvert') });
        ligne.style?.setProperty?.('--cordee-couleur', couleurAuteur(e.auteurs?.[0]));
        const ouvrir = boutonCordee(ligne, '', async () => { try { await p.ouvrirModif(chemin); } catch { new O.Notice(`Impossible d’ouvrir ${chemin}.`); } }, { label: `Ouvrir ${chemin} sur les modifications`, cls: 'cordee-a-voir-ouvrir' });
        const tete = ouvrir.createEl('span', { cls: 'cordee-fichier-tete' });
        tete.createEl('strong', { text: nomFichier(chemin), cls: 'cordee-fichier-chemin' });
        if (dossierDe(chemin)) tete.createEl('span', { text: dossierDe(chemin), cls: 'cordee-fichier-dossier' });
        ouvrir.createEl('span', { text: resumeModif(e), cls: 'cordee-details' });
        boutonCordee(ligne, 'Vu', () => p.marquerVu(chemin), { label: `Marquer ${chemin} comme vu`, cls: 'cordee-bouton-discret cordee-bouton-vu' });
      }
      if (entrees.length > 30) zone.createEl('p', { text: `Et ${entrees.length - 30} autre(s).`, cls: 'cordee-details' });
    }
    async charger() {
      if (!this.actif()) return;
      const tour = this.tour = (this.tour || 0) + 1;
      const filtre = this.filtre;
      this.zone.empty(); this.zone.createEl('p', { text: 'Chargement de l’activité…', cls: 'cordee-vide' });
      try {
        let info, ancien = false;
        try {
          info = await (await this.plugin.moteur.api('GET', `/api/coffres/${this.coffreId}/activite?limite=40${filtre ? '&auteur=' + encodeURIComponent(filtre) : ''}`)).json();
          if (!Array.isArray(info.membres) || !Array.isArray(info.changements)) { const erreur = new Error('Ancien format'); erreur.statut = 404; throw erreur; }
        } catch (erreur) {
          if (erreur.statut !== 404) throw erreur;
          if (!this.actif() || this.tour !== tour) return;
          info = await (await this.plugin.moteur.api('GET', `/api/coffres/${this.coffreId}`)).json();
          if (!this.actif() || this.tour !== tour) return;
          const r = await (await this.plugin.moteur.api('GET', `/api/coffres/${this.coffreId}/changements?depuis=${Math.max(0, info.rev - 40)}`)).json();
          info = { ...info, changements: r.changements.slice(-40).reverse() }; ancien = true;
        }
        if (!this.actif() || this.tour !== tour) return;
        if (!filtre) this.comptes = info.changements.reduce((comptes, ch) => comptes.set(ch.auteurId, (comptes.get(ch.auteurId) || 0) + 1), new Map());
        this.nombre.setText(`${info.membres.length} membre${info.membres.length > 1 ? 's' : ''}`);
        this.membresEl.empty();
        const tous = boutonCordee(this.membresEl, 'Tous', () => { this.filtre = null; return this.charger(); }, { cls: 'cordee-collegue cordee-collegue-tous', attr: { 'aria-pressed': String(!filtre) } });
        tous.createEl('span', { text: 'Toute la cordée', cls: 'cordee-details' });
        for (const membre of info.membres) {
          const bouton = boutonCordee(this.membresEl, '', () => { this.filtre = membre.id; return this.charger(); }, { label: `Voir les changements de ${membre.nom}`, cls: 'cordee-collegue', attr: { 'aria-pressed': String(filtre === membre.id), 'data-membre-id': membre.id || '' } });
          bouton.disabled = !membre.id;
          afficherAvatar(bouton, membre.nom, membre.avatar);
          const identite = bouton.createEl('span', { cls: 'cordee-collegue-identite' });
          identite.createEl('strong', { text: membre.nom });
          const n = this.comptes.get(membre.id) || 0;
          identite.createEl('span', { text: membre.id ? (n ? `${n} changement${n > 1 ? 's' : ''} récent${n > 1 ? 's' : ''}` : 'Rien de récent') : 'Membre du groupe', cls: 'cordee-details' });
        }
        const selection = info.membres.find((m) => m.id === filtre);
        this.titreActivite.setText(filtre ? `Changements de ${selection?.nom || 'ce membre'}` : 'Derniers changements');
        this.information.setText(ancien ? 'Serveur ancien : mets Cordée à jour pour filtrer tous les membres et comparer les versions.' : '40 changements maximum · Clique sur un fichier pour comparer ses versions.');
        const changements = info.changements.filter((ch) => !filtre || ch.auteurId === filtre).slice(0, 40);
        this.zone.empty();
        if (!changements.length) this.zone.createEl('div', { text: filtre ? 'Aucun changement récent pour ce membre.' : 'Aucun changement partagé pour le moment.', cls: 'cordee-vide' });
        const profils = new Map(info.membres.filter((m) => m.id).map((m) => [m.id, m]));
        for (const ch of changements) {
          const carte = boutonCordee(this.zone, '', () => new RevisionModal(this.app, this.plugin, ch.rev, profils.get(ch.auteurId)).open(), { label: `Comparer ${ch.chemin}, révision ${ch.rev}`, cls: 'cordee-fichier', attr: { 'data-revision': String(ch.rev) } });
          carte.disabled = ancien || !Number.isSafeInteger(ch.rev);
          afficherAvatar(carte, ch.auteur, profils.get(ch.auteurId)?.avatar);
          const contenu = carte.createEl('span', { cls: 'cordee-fichier-contenu' });
          const tete = contenu.createEl('span', { cls: 'cordee-fichier-tete' });
          tete.createEl('strong', { text: nomFichier(ch.chemin), cls: 'cordee-fichier-chemin' });
          if (dossierDe(ch.chemin)) tete.createEl('span', { text: dossierDe(ch.chemin), cls: 'cordee-fichier-dossier' });
          contenu.createEl('span', { text: `${ch.auteur || 'Membre'} · ${ch.supprime ? 'a supprimé' : 'a modifié'} ${nomFichier(ch.chemin)} · ${ilYa(ch.le)}`, cls: 'cordee-fichier-auteur', attr: { title: new Date(ch.le).toLocaleString('fr-FR') } });
          const genre = ch.type === 'dossier' ? 'dossier' : ch.supprime ? 'supprime' : ch.avantHash ? 'modifie' : 'ajoute';
          carte.createEl('span', { text: { dossier: 'Dossier', supprime: 'Supprimé', modifie: 'Modifié', ajoute: 'Ajouté' }[genre], cls: `cordee-type-changement cordee-type-${genre}` });
          carte.createEl('span', { text: '↗', cls: 'cordee-fichier-fleche', attr: { 'aria-hidden': 'true' } });
        }
      } catch (erreur) { if (this.actif() && this.tour === tour) { this.zone.empty(); this.zone.createEl('p', { text: expliquerErreur(erreur), cls: 'cordee-vide' }); } }
    }
    detruire() { this.detruit = true; ++this.tour; this.desabonner?.(); }
  }

  ActiviteModal = class extends O.Modal {
    constructor(app, plugin) { super(app); this.plugin = plugin; }
    onOpen() { this.tableau?.detruire(); this.modalEl?.classList.add('cordee-tableau-modal'); this.tableau = new TableauActivite(this.app, this.plugin, this.contentEl); return this.tableau.chargement; }
    onClose() { this.tableau?.detruire(); this.contentEl.empty(); }
  };

  ReglagesCordee = class extends O.PluginSettingTab {
    constructor(app, plugin) {
      super(app, plugin); this.plugin = plugin;
      const preferences = lirePreferences();
      this.form = { serveur: preferences.serveur || plugin.etat.serveur, prenom: preferences.prenom || plugin.etat.prenom, invitation: '', nom: app.vault.getName?.() || '', code: '', creer: false, adresseVisible: false, dossiersIgnores: plugin.etat.dossiersIgnores || '' };
    }
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
        const identite = c.createEl('p');
        const statut = c.createEl('p', { cls: 'cordee-etat' });
        const chiffres = c.createEl('p', { cls: 'cordee-details' });
        const attention = c.createEl('p', { cls: 'cordee-attention' });
        let boutonPause;
        const automatique = new O.Setting(c).setName('Synchronisation automatique').addButton((b) => { boutonPause = b; b.onClick(async () => { await p.mettreEnPause(!e.enPause); }); });
        this.desabonner = p.abonnerStatut(() => {
          identite.setText(`Serveur ${e.serveur} · connecté en tant que ${e.prenom}`);
          boutonPause.setButtonText(e.enPause ? 'Reprendre' : 'Mettre en pause');
          automatique.setDesc(e.enPause ? 'Tes prochaines modifications resteront locales jusqu’à la reprise.' : 'Envoi des modifications et réception des changements du groupe.');
          statut.setText(p.titreStatut());
          const derniere = e.derniereSynchro ? new Date(e.derniereSynchro).toLocaleString('fr-FR') : 'pas encore effectuée';
          chiffres.setText(`${Object.keys(e.bases).length} fichiers partagés · Dernière synchronisation : ${derniere}`);
          attention.setText(p.derniereErreur || p.texteBloques?.() || (p.suppressionsBloquees ? `${p.suppressionsBloquees} suppressions attendent ta confirmation (commande « Confirmer les suppressions en attente »).` : p.fichiersTropGros.size ? `${p.fichiersTropGros.size} fichier(s) dépassent la limite de 50 Mo et n’ont pas été envoyés.` : e.enPause ? 'Les prochaines synchronisations sont suspendues. Une opération déjà lancée se termine normalement.' : ''));
          attention.hidden = !attention.textContent;
        });
        new O.Setting(c).setName('Inviter un ami').setDesc('Crée un lien à lui envoyer.').addButton((b) => b.setButtonText('Créer une invitation').setCta().onClick(() => p.inviter()));
        new O.Setting(c).setName('Synchroniser maintenant').setDesc('Lance une synchronisation ponctuelle, même pendant la pause.').addButton((b) => b.setButtonText('Synchroniser').onClick(() => p.lancer({ forcer: true })));
        new O.Setting(c).setName('Membres et activité').setDesc('Retrouve les membres du groupe et les 40 derniers changements.').addButton((b) => b.setButtonText('Voir l’activité').onClick(() => new ActiviteModal(this.app, p).open()));
        new O.Setting(c).setName('Mon profil').setDesc('Modifie ton nom affiché et ta photo pour ce groupe.').addButton((b) => b.setButtonText('Mon profil').onClick(() => new ProfilModal(this.app, p).open()));
        new O.Setting(c).setName('Dossiers non partagés').setDesc('Séparés par des virgules, par exemple : Brouillons, Perso').addText((t) => t.setValue(e.dossiersIgnores).onChange(async (v) => { e.dossiersIgnores = v; await p.saveData(e); }));
        new O.Setting(c).setName('Quitter ce coffre').setDesc('Tes fichiers restent sur ton ordinateur ; ils ne se synchronisent plus.').addButton((b) => b.setButtonText('Quitter').setWarning().onClick(async () => { await p.quitter(); rafraichir(); }));
        return;
      }
      c.createEl('h3', { text: 'Rejoindre un coffre' });
      c.createEl('p', { text: 'Pars de préférence d’un coffre vide. Les notes de ce coffre seront partagées avec le groupe.' });
      new O.Setting(c).setName('Nom affiché').setDesc('Visible par le groupe. Tu pourras le modifier dans Mon profil.').addText((t) => t.setValue(f.prenom).onChange((v) => { f.prenom = v; }));
      const serveur = new O.Setting(c).setName('Serveur').setDesc(f.serveur || 'Une invitation complète renseigne le serveur automatiquement.').addButton((b) => b.setButtonText('Changer de serveur').onClick(() => { f.adresseVisible = !f.adresseVisible; rafraichir(); }));
      let champServeur;
      if (f.adresseVisible || (!f.serveur && f.creer)) new O.Setting(c).setName('Adresse du serveur').addText((t) => { champServeur = t; t.setPlaceholder('https://cordee.exemple.fr').setValue(f.serveur).onChange((v) => { f.serveur = v.trim(); serveur.setDesc(f.serveur || 'Colle une invitation complète ou indique le serveur.'); }); });
      new O.Setting(c).setName('Invitation ou code').setDesc('Colle le lien reçu. Si le serveur est déjà renseigné, le code seul suffit.').addText((t) => t.setValue(f.invitation).onChange((v) => {
        f.invitation = v;
        const invitation = lireInvitation(v, f.serveur);
        if (invitation) { f.serveur = invitation.serveur; champServeur?.setValue(f.serveur); serveur.setDesc(`Serveur de l’invitation : ${invitation.serveur}`); }
      }));
      new O.Setting(c).addButton((b) => b.setButtonText('Rejoindre').setCta().onClick(async () => {
        const inv = lireInvitation(f.invitation, f.serveur);
        if (!inv?.serveur || !/^[A-Za-z0-9-]{1,20}$/.test(inv.code)) { new O.Notice('Colle une invitation complète, ou indique le serveur pour utiliser un code seul.'); return; }
        if (!f.prenom.trim() || f.prenom.trim().length > 60) { new O.Notice('Indique un nom affiché de 1 à 60 caractères.'); return; }
        e.dossiersIgnores = f.dossiersIgnores;
        try { await p.rejoindreOuCreer('/api/rejoindre', { code: inv.code, prenom: f.prenom.trim() }, inv.serveur); rafraichir(); }
        catch (err) { new O.Notice('Cordée : ' + err.message); }
      }));
      new O.Setting(c).setName('Dossiers non partagés').setDesc('Facultatif. À exclure avant le premier envoi, séparés par des virgules.').addText((t) => t.setValue(f.dossiersIgnores).onChange((v) => { f.dossiersIgnores = v; }));
      if (!f.creer) {
        new O.Setting(c).setName('Partager ce coffre avec des amis').setDesc('Crée un nouveau groupe sur ton serveur.').addButton((b) => b.setButtonText('Créer un nouveau partage').onClick(() => { f.creer = true; rafraichir(); }));
        return;
      }
      c.createEl('h3', { text: 'Ou créer un coffre partagé' });
      c.createEl('p', { text: "Il faut le code de création donné par la personne qui héberge le serveur. Tout ce coffre sera envoyé." });
      new O.Setting(c).setName('Nom du coffre').addText((t) => t.setValue(f.nom).onChange((v) => { f.nom = v; }));
      new O.Setting(c).setName('Code de création').addText((t) => { t.inputEl.type = 'password'; t.onChange((v) => { f.code = v; }); });
      new O.Setting(c).addButton((b) => b.setButtonText('Créer et partager').setCta().onClick(async () => {
        if (!invitationValide(new URLSearchParams({ serveur: f.serveur, code: 'test' }))) { new O.Notice('Indique une adresse de serveur HTTP ou HTTPS valide.'); return; }
        if (!f.nom.trim() || !f.prenom.trim() || f.prenom.trim().length > 60 || !f.code.trim()) { new O.Notice('Indique le nom du coffre, ton nom affiché (1 à 60 caractères) et le code de création.'); return; }
        e.dossiersIgnores = f.dossiersIgnores;
        try { await p.rejoindreOuCreer('/api/coffres', { nom: f.nom.trim(), prenom: f.prenom.trim(), codeCreation: f.code.trim() }, f.serveur); rafraichir(); }
        catch (err) { new O.Notice('Cordée : ' + err.message); }
      }));
    }
  };

  PanneauCordee = class extends O.Modal {
    constructor(app, plugin) { super(app); this.plugin = plugin; this.reglages = new ReglagesCordee(app, plugin); }
    onOpen() {
      this.tableau?.detruire(); this.reglages.nettoyer();
      if (!this.plugin.connecte()) { this.reglages.afficherDans(this.contentEl, () => this.onOpen()); return; }
      this.modalEl?.classList.add('cordee-tableau-modal');
      this.tableau = new TableauActivite(this.app, this.plugin, this.contentEl, () => this.afficherReglages());
      return this.tableau.chargement;
    }
    afficherReglages() {
      this.tableau?.detruire(); this.tableau = null;
      this.reglages.afficherDans(this.contentEl, () => this.onOpen());
      boutonCordee(this.contentEl, 'Retour à l’activité', () => this.onOpen(), { cls: 'cordee-bouton-discret' });
    }
    onClose() { this.tableau?.detruire(); this.reglages.nettoyer(); this.contentEl.empty(); }
  };
}

module.exports = CordeePlugin;
module.exports.default = CordeePlugin;
module.exports.interne = { VERSION, comparerVersions, lignesModifiees, couleurAuteur, ilYa, echapperCss, fusionner, Moteur, empreinte, versBuffer, versTexte, nomCopieConflit, lireInvitation, expliquerErreur, avatarValide, preparerPhoto, calculerDiff, premierBlocModifie };
