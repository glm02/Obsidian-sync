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
const VERSION = '0.3.0';
// Première version qui sait créer et supprimer des dossiers : en dessous, un ami voit les fichiers partir mais pas les dossiers.
const VERSION_DOSSIERS = '0.1.5';

function comparerVersions(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  return 0;
}

const PAR_DEFAUT = { serveur: '', coffreId: '', nomCoffre: '', jeton: '', prenom: '', derniereRev: 0, bases: {}, cache: {}, dossiers: {}, enAttente: {}, aVoir: {}, calendriers: [], cacheCalendriers: {}, dossiersIgnores: '', enPause: false, derniereSynchro: null };

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

let InvitationModal, ActiviteModal, RevisionModal, ProfilModal, ReglagesCordee, PanneauCordee, VuePanneau, HistoriqueModal;
const VUE_CORDEE = 'cordee-panneau';
const VUE_SEMAINE = 'cordee-semaine';
let VueSemaine, EvenementModal, CreneauModal, dessinerSemaine;
const identifiantLocal = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

class CordeePlugin extends (O ? O.Plugin : Object) {
  async onload() {
    this.etat = Object.assign({}, PAR_DEFAUT, await this.loadData());
    this.initialiserMoodle();
    if (this.connecte()) this.memoriserPreferences();
    this.phase = 'pret';
    this.derniereErreur = '';
    this.abonnesStatut = new Set();
    this.fichiersTropGros = new Set();
    this.fichiersBloques = new Map();
    this.dossiersEnAttente = new Set();
    this.etat.aVoir = this.nettoyerAVoir(this.etat.aVoir);
    this.etat.calendriers = [...(this.etat.calendriers || [])];
    this.etat.cacheCalendriers = { ...(this.etat.cacheCalendriers || {}) };
    this.abonnesCalendrier = new Set();
    this.barre = this.addStatusBarItem();
    // La barre d'état ouvre le panneau : c'est là qu'on regarde quand quelque chose a bougé.
    this.barre.addClass?.('mod-clickable');
    this.barre.onClickEvent?.(() => this.ouvrirPanneau());
    this.presence = [];
    if (O.ItemView && this.registerView) { this.registerView(VUE_CORDEE, (leaf) => new VuePanneau(leaf, this)); this.registerView(VUE_SEMAINE, (leaf) => new VueSemaine(leaf, this)); }
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
    this.addRibbonIcon('calendar-days', 'Cordée — la semaine', () => this.ouvrirSemaine());
    this.addRibbonIcon('cordee-logo', 'Cordée — ouvrir le partage', () => this.ouvrirPanneau());
    this.addCommand({ id: 'ouvrir', name: 'Ouvrir le panneau de partage', callback: () => this.ouvrirPanneau() });
    this.addCommand({ id: 'historique', name: 'Historique de cette note (versions, restauration)', callback: () => { const f = this.app.workspace.getActiveFile?.(); if (f) new HistoriqueModal(this.app, this, f.path).open(); else new O.Notice('Ouvre d’abord une note.'); } });
    this.addCommand({ id: 'semaine', name: 'Ouvrir la semaine (emploi du temps, Moodle, agenda de la cordée)', callback: () => this.ouvrirSemaine() });
    this.addCommand({ id: 'cours-moodle', name: 'Cours Moodle', callback: () => new CoursMoodleModal(this.app, this).open() });
    this.addCommand({ id: 'notes-moodle', name: 'Mes notes Moodle (sur cet appareil)', callback: () => new NotesMoodleModal(this.app, this).open() });
    this.addCommand({ id: 'creneau', name: 'Ajouter un créneau à l’agenda de la cordée', callback: () => new CreneauModal(this.app, this).open() });
    this.addCommand({ id: 'presence', name: 'Montrer ou masquer aux autres la note que j’ouvre', callback: () => this.basculerPresence() });
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
      this.registerEvent(this.app.workspace.on('file-open', (f) => this.annoncerPresence(f?.path ?? null)));
      this.registerInterval(window.setInterval(() => this.annoncerPresence(this.app.workspace.getActiveFile?.()?.path ?? null), 45_000));
      this.registerEvent(this.app.workspace.on('file-menu', (menu, f) => {
        if (!this.connecte() || !f || (O.TFolder && f instanceof O.TFolder)) return;
        menu.addItem((item) => item.setTitle('Historique Cordée').setIcon('history').onClick(() => new HistoriqueModal(this.app, this, f.path).open()));
      }));
      this.annoncerPresence(this.app.workspace.getActiveFile?.()?.path ?? null);
      this.actualiserCalendriers();
      this.demarrerMoodle();
      this.registerInterval(window.setInterval(() => this.actualiserCalendriers(), 30 * 60_000));
      this.registerEvent(this.app.vault.on('modify', (f) => { if (f?.path === NOTE_AGENDA) this.rafraichirCalendrier(); }));
      this.registerInterval(window.setInterval(() => this.lancer(), 5 * 60_000)); // filet de sécurité
      this.ecouter();
      this.lancer();
    });
  }

  onunload() {
    if (this.connecte() && !this.presenceIndisponible) this.moteur.api('POST', `/api/coffres/${this.etat.coffreId}/presence`, { parti: true }).catch(() => {});
    this.arret = true; clearTimeout(this.minuteur); clearTimeout(this.minuteurMarques); this.abonnesStatut.clear(); this.styleMarques?.remove?.(); }

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
    const actif = this.app.workspace.getActiveFile?.()?.path;
    if (actif === chemin) new O.Notice(`Cordée : ${info.auteur || 'un membre'} vient de modifier cette note (${resumeModif({ ...this.etat.aVoir[chemin], auteurs: [info.auteur || 'Un membre'], ajouts: info.ajouts, suppressions: info.suppressions, le: Date.now() }).split(' · ')[1]}). Ses lignes sont surlignées.`, 7000);
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
        const parNote = new Map();
        for (const p of this.presence || []) if (p.chemin) parNote.set(p.chemin, [...(parNote.get(p.chemin) || []), p.nom]);
        this.styleMarques.textContent = [...parNote].map(([chemin, noms]) =>
          `.nav-file-title[data-path="${echapperCss(chemin)}"]::after { content: "${echapperCss(noms.join(', '))}"; margin-inline-start: auto; padding: 0 7px; border-radius: 999px; font-size: var(--font-ui-smaller); line-height: 1.5; white-space: nowrap; color: var(--text-on-accent); background: ${couleurAuteur(noms[0])}; }`).join('\n') + '\n' + Object.entries(this.etat.aVoir).filter(([, e]) => !e.ouvert).map(([chemin, e]) =>
          `.nav-file-title[data-path="${echapperCss(chemin)}"] .nav-file-title-content::after { content: ""; display: inline-block; width: 7px; height: 7px; margin-inline-start: 6px; border-radius: 50%; vertical-align: middle; background: ${couleurAuteur(e.auteurs?.[0])}; }`).join('\n');
      }
      if (this.effetRafraichir) this.app.workspace.iterateAllLeaves?.((leaf) => { const cm = leaf.view?.editor?.cm; if (cm?.dispatch) cm.dispatch({ effects: this.effetRafraichir.of(null) }); });
      this.afficher();
    }, delai);
  }

  /**
   * Ouvre le panneau Cordée dans la barre latérale droite (il reste visible pendant qu'on écrit).
   * Sans barre latérale (tests, très vieil Obsidian), on retombe sur la fenêtre.
   */
  async ouvrirPanneau() {
    const ws = this.app.workspace;
    if (!O.ItemView || !ws.getRightLeaf || !ws.getLeavesOfType) return new PanneauCordee(this.app, this).open();
    let leaf = ws.getLeavesOfType(VUE_CORDEE)[0];
    if (!leaf) { leaf = ws.getRightLeaf(false); await leaf.setViewState({ type: VUE_CORDEE, active: true }); }
    ws.revealLeaf(leaf);
  }

  /* ---------- Présence : qui a quelle note ouverte ---------- */

  majPresence(liste) {
    const propre = liste.filter((p) => p && typeof p.nom === 'string').map((p) => ({ id: p.id, nom: p.nom, chemin: typeof p.chemin === 'string' ? p.chemin : null }));
    if (JSON.stringify(propre) === JSON.stringify(this.presence)) return;
    const actif = this.app.workspace.getActiveFile?.()?.path;
    const avant = new Set(this.presence.filter((p) => p.chemin === actif).map((p) => p.id));
    const arrives = propre.filter((p) => actif && p.chemin === actif && !avant.has(p.id));
    if (arrives.length) new O.Notice(`Cordée : ${arrives.map((p) => p.nom).join(', ')} ${arrives.length > 1 ? 'sont' : 'est'} aussi sur cette note.`, 5000);
    this.presence = propre;
    this.rafraichirMarques();
  }

  /**
   * Dit au serveur quelle note est ouverte ici. Jamais une note d'un dossier non partagé : on envoie
   * alors « aucune note ». Rien du contenu, seulement le chemin, déjà connu de tous les membres.
   */
  async annoncerPresence(chemin) {
    if (!this.connecte() || this.arret || this.presenceIndisponible) return;
    const partage = chemin && !this.moteur.ignorer(chemin) ? chemin : null;
    const corps = this.etat.presenceMasquee || this.etat.enPause ? { parti: true } : { chemin: partage };
    try {
      const r = await (await this.moteur.api('POST', `/api/coffres/${this.etat.coffreId}/presence`, corps)).json();
      if (Array.isArray(r.presence)) this.majPresence(r.presence);
    } catch (e) { if (e?.statut === 404) this.presenceIndisponible = true; } // ancien serveur : sans présence, rien ne change
  }

  async basculerPresence() {
    this.etat.presenceMasquee = !this.etat.presenceMasquee;
    try { await this.saveData(this.etat); } catch { /* simple préférence */ }
    await this.annoncerPresence(this.app.workspace.getActiveFile?.()?.path ?? null);
    new O.Notice(this.etat.presenceMasquee ? 'Cordée : les autres ne voient plus quelle note tu as ouverte.' : 'Cordée : les autres voient à nouveau quelle note tu as ouverte.');
  }

  presenceSur(chemin) { return this.presence.filter((p) => p.chemin === chemin); }

  /** Remet une ancienne version d'un fichier ; elle part chez les autres à la synchro suivante. */
  async restaurer(chemin, hash) {
    const contenu = await this.moteur.telecharger(hash);
    await this.moteur.fichiers.ecrire(chemin, contenu);
    if (this.etat.aVoir[chemin]) delete this.etat.aVoir[chemin];
    this.rafraichirMarques(0);
    this.programmer(800);
  }

  /* ---------- Calendrier ---------- */

  async ouvrirSemaine() {
    const ws = this.app.workspace;
    if (!O.ItemView || !ws.getLeavesOfType || !ws.getLeaf) { new O.Notice('La vue semaine demande une version plus récente d’Obsidian.'); return; }
    let leaf = ws.getLeavesOfType(VUE_SEMAINE)[0];
    if (!leaf) { leaf = ws.getLeaf('tab'); await leaf.setViewState({ type: VUE_SEMAINE, active: true }); }
    ws.revealLeaf(leaf);
  }

  surCalendrier(f) { this.abonnesCalendrier.add(f); return () => this.abonnesCalendrier.delete(f); }
  rafraichirCalendrier() { for (const f of this.abonnesCalendrier) { try { f(); } catch { /* une vue fermée ne doit pas gêner les autres */ } } }

  /** Lit un lien iCal par le réseau d'Obsidian (pas de souci de CORS, marche sur mobile). Le lien n'est jamais affiché ni journalisé. */
  async lireUrlCalendrier(url) {
    const r = await O.requestUrl({ url: String(url).replace(/^webcal:/i, 'https:'), throw: false });
    if (r.status >= 400) throw Object.assign(new Error(`le serveur du calendrier répond ${r.status}`), { statut: r.status });
    const texte = r.text || '';
    if (!/BEGIN:VCALENDAR/.test(texte)) throw new Error('ce lien ne renvoie pas un calendrier iCal');
    return texte;
  }

  async ajouterCalendrier(nom, url) {
    const lien = String(url || '').trim();
    if (!/^(https?|webcal):\/\/\S+$/i.test(lien)) throw new Error('Colle un lien iCal complet, qui commence par https:// ou webcal://');
    const source = { id: identifiantLocal(), nom: String(nom || '').trim().slice(0, 40) || ({ moodle: 'Moodle', edt: 'Emploi du temps' }[typeCalendrier(lien)] || 'Calendrier'), url: lien, type: typeCalendrier(lien) };
    this.etat.calendriers.push(source);
    await this.saveData(this.etat);
    await this.actualiserCalendriers({ forcer: true, seulement: source.id });
    return source;
  }

  async retirerCalendrier(id) {
    this.etat.calendriers = this.etat.calendriers.filter((s) => s.id !== id);
    delete this.etat.cacheCalendriers[id];
    await this.saveData(this.etat);
    this.rafraichirCalendrier();
  }

  /** Recharge les calendriers (au plus toutes les 25 min, sauf demande) ; garde la dernière version si le réseau manque. */
  async actualiserCalendriers({ forcer = false, seulement = null } = {}) {
    if (this.calendriersEnCours) return this.calendriersEnCours;
    this.calendriersEnCours = (async () => {
      for (const s of this.etat.calendriers) {
        if (seulement && s.id !== seulement) continue;
        const cache = this.etat.cacheCalendriers[s.id];
        if (!forcer && cache?.maj && Date.now() - cache.maj < 25 * 60_000) continue;
        try {
          const evts = lireIcs(await this.lireUrlCalendrier(s.url))
            .map((e) => ({ titre: e.titre || 'Sans titre', lieu: e.lieu || '', description: (e.description || '').slice(0, 600), debut: e.debut, fin: e.fin, journee: !!e.journee, rrule: e.rrule, exdates: e.exdates }))
            .slice(0, 5000);
          this.etat.cacheCalendriers[s.id] = { maj: Date.now(), evenements: evts, erreur: null };
        } catch (e) {
          this.etat.cacheCalendriers[s.id] = { ...(cache || { evenements: [] }), erreur: e?.message || 'lecture impossible', essai: Date.now() };
        }
      }
      try { await this.saveData(this.etat); } catch { /* le cache se refera */ }
    })();
    try { await this.calendriersEnCours; } finally { this.calendriersEnCours = null; this.rafraichirCalendrier(); }
  }

  /** Tous les événements de [de, a[ : calendriers iCal de cet appareil + agenda de la cordée (note partagée). */
  async evenementsEntre(de, a) {
    const tous = [];
    for (const s of this.etat.calendriers) {
      const cache = this.etat.cacheCalendriers[s.id];
      for (const e of developper(cache?.evenements || [], de, a)) tous.push({ ...e, source: s.nom, type: s.type, couleur: COULEURS_CALENDRIER[s.type] || COULEURS_CALENDRIER.autre });
    }
    const note = this.app.vault.getAbstractFileByPath?.(NOTE_AGENDA);
    if (note && (!O.TFile || note instanceof O.TFile)) {
      try {
        for (const e of lireAgendaPartage(await this.app.vault.cachedRead(note))) if (e.fin > de && e.debut < a) tous.push({ ...e, source: 'Agenda de la cordée', type: 'cordee', couleur: COULEURS_CALENDRIER.cordee });
      } catch { /* note en cours d'écriture : elle reviendra au prochain affichage */ }
    }
    return tous.sort((x, y) => x.debut - y.debut);
  }

  ouvrirReglages() {
    const reglages = this.app.setting;
    if (reglages?.open) { reglages.open(); reglages.openTabById?.(this.manifest?.id || 'cordee'); }
    else new O.Notice('Ouvre Réglages → Cordée → Calendriers.');
  }

  /** Une note partagée pour un cours ou un créneau (dossier Agenda), pour y écrire à plusieurs. */
  async creerNoteEvenement(e) {
    const titre = String(e.titre || 'Événement').replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
    const chemin = `Agenda/${jourIso(e.debut)} ${titre}.md`;
    const vault = this.app.vault;
    if (!vault.getAbstractFileByPath(chemin)) {
      if (!vault.getAbstractFileByPath('Agenda')) { try { await vault.createFolder('Agenda'); } catch { /* déjà créé entre-temps */ } }
      const quand = e.journee ? jourIso(e.debut) : `${jourIso(e.debut)} ${heure(e.debut)}–${heure(e.fin)}`;
      await vault.create(chemin, `# ${e.titre || 'Événement'}\n\n- Quand : ${quand}\n${e.lieu ? `- Où : ${e.lieu}\n` : ''}- Source : ${e.source || 'calendrier'}\n\n## Notes\n\n`);
    }
    await this.app.workspace.openLinkText(chemin, '', false);
    return chemin;
  }

  /** Ajoute un créneau à l'agenda de la cordée : une ligne dans une note partagée, donc visible par tous. */
  async ajouterCreneau(creneau) {
    const ligne = ligneAgenda({ ...creneau, auteur: this.etat.prenom || '' });
    const vault = this.app.vault;
    const note = vault.getAbstractFileByPath(NOTE_AGENDA);
    if (note) await vault.process(note, (t) => t.replace(/\s*$/, '\n') + ligne + '\n');
    else await vault.create(NOTE_AGENDA, `# Agenda de la cordée\n\nUne ligne par créneau, visible par toute la cordée dans la vue Semaine de Cordée.\nFormat : - AAAA-MM-JJ HH:MM-HH:MM Titre @ Lieu\n\n${ligne}\n`);
    this.rafraichirCalendrier();
    return ligne;
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
    const enLigne = this.connecte() ? [...new Set((this.presence || []).map((p) => p.nom))] : [];
    this.barre.setText(`Cordée : ${this.titreStatut()}${aVoir ? ` · ${aVoir} à voir` : ''}${enLigne.length ? ` · ${enLigne.slice(0, 2).join(', ')}${enLigne.length > 2 ? '…' : ''} en ligne` : ''}`);
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
        if (Array.isArray(info.presence)) this.majPresence(info.presence);
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

/* ---------- Calendrier : emploi du temps (iCal), Moodle et agenda partagé ---------- */

// Les liens iCal restent dans les réglages de CET appareil (dossier de configuration, jamais synchronisé) :
// un lien Moodle contient une clé personnelle. Seul l'agenda de la cordée, une note ordinaire, est partagé.
const NOTE_AGENDA = 'Agenda de la cordée.md';
const COULEURS_CALENDRIER = { edt: 'var(--color-blue)', moodle: 'var(--color-orange)', autre: 'var(--color-purple)', cordee: 'var(--color-green)' };
const JOUR = 24 * 3600_000;

/** « 20261112T080000Z » (UTC), « 20261112T080000 » (heure locale ou TZID, supposé être celui de l'appareil), « 20261112 » (journée). */
function lireDateIcs(valeur) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(valeur).trim());
  if (!m) return null;
  const [, a, mo, j, h, mi, s, z] = m;
  if (h === undefined) return { ms: new Date(+a, +mo - 1, +j).getTime(), journee: true };
  if (z) return { ms: Date.UTC(+a, +mo - 1, +j, +h, +mi, +(s || 0)), journee: false };
  return { ms: new Date(+a, +mo - 1, +j, +h, +mi, +(s || 0)).getTime(), journee: false };
}

const texteIcs = (v) => String(v).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

/** Événements d'un fichier iCal (VEVENT), répétitions non développées. Tolère les lignes repliées et les fins de ligne Windows. */
function lireIcs(texte) {
  const lignes = String(texte).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const evts = [];
  let e = null;
  for (const ligne of lignes) {
    if (ligne === 'BEGIN:VEVENT') { e = { exdates: [] }; continue; }
    if (ligne === 'END:VEVENT') {
      if (e && Number.isFinite(e.debut)) { if (!Number.isFinite(e.fin)) e.fin = e.journee ? e.debut + JOUR : e.debut; evts.push(e); }
      e = null; continue;
    }
    if (!e) continue;
    const i = ligne.indexOf(':');
    if (i < 0) continue;
    const nom = ligne.slice(0, i).split(';')[0].toUpperCase();
    const valeur = ligne.slice(i + 1);
    if (nom === 'UID') e.uid = valeur;
    else if (nom === 'SUMMARY') e.titre = texteIcs(valeur).slice(0, 300);
    else if (nom === 'LOCATION') e.lieu = texteIcs(valeur).slice(0, 300);
    else if (nom === 'DESCRIPTION') e.description = texteIcs(valeur).slice(0, 1500);
    else if (nom === 'DTSTART') { const d = lireDateIcs(valeur); if (d) { e.debut = d.ms; e.journee = d.journee; } }
    else if (nom === 'DTEND') { const d = lireDateIcs(valeur); if (d) e.fin = d.ms; }
    else if (nom === 'RRULE') e.rrule = valeur;
    else if (nom === 'EXDATE') for (const v of valeur.split(',')) { const d = lireDateIcs(v); if (d) e.exdates.push(d.ms); }
  }
  return evts;
}

const JOURS_ICS = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };
const rangLundi = (jour) => (jour + 6) % 7;

/**
 * Événements qui touchent [de, a[, répétitions quotidiennes et hebdomadaires développées
 * (INTERVAL, COUNT, UNTIL, BYDAY, EXDATE). Les autres répétitions gardent leur première date.
 */
function developper(evts, de, a) {
  const sortie = [];
  for (const e of evts) {
    const duree = Math.max(0, e.fin - e.debut);
    const r = e.rrule ? Object.fromEntries(e.rrule.split(';').map((p) => p.split('='))) : null;
    if (!r || (r.FREQ !== 'DAILY' && r.FREQ !== 'WEEKLY')) { if (e.fin > de && e.debut < a || (duree === 0 && e.debut >= de && e.debut < a)) sortie.push(e); continue; }
    const intervalle = Math.max(1, Number(r.INTERVAL) || 1);
    const compte = r.COUNT ? Number(r.COUNT) : Infinity;
    const jusqua = r.UNTIL ? (lireDateIcs(r.UNTIL)?.ms ?? Infinity) : Infinity;
    const jours = r.FREQ === 'WEEKLY' && r.BYDAY ? r.BYDAY.split(',').map((j) => JOURS_ICS[j.slice(-2)]).filter((j) => j !== undefined) : null;
    const exclus = new Set(e.exdates || []);
    const premier = new Date(e.debut);
    let n = 0, fini = false;
    for (let k = 0; k < 3000 && !fini; k++) {
      const candidats = [];
      if (r.FREQ === 'DAILY') { const d = new Date(premier); d.setDate(d.getDate() + k * intervalle); candidats.push(d); }
      else {
        const lundi = new Date(premier); lundi.setDate(lundi.getDate() - rangLundi(lundi.getDay()) + k * 7 * intervalle);
        for (const j of [...(jours || [premier.getDay()])].sort((x, y) => rangLundi(x) - rangLundi(y))) { const d = new Date(lundi); d.setDate(d.getDate() + rangLundi(j)); candidats.push(d); }
      }
      for (const d of candidats) {
        const ms = d.getTime();
        if (ms < e.debut) continue;
        if (ms > jusqua || n >= compte || ms >= a) { fini = true; break; }
        n++;
        if (!exclus.has(ms) && ms + duree > de) sortie.push({ ...e, debut: ms, fin: ms + duree, rrule: undefined });
      }
    }
  }
  return sortie.sort((x, y) => x.debut - y.debut);
}

/** Type d'un lien iCal, pour la couleur et le libellé : emploi du temps, Moodle (devoirs) ou autre. */
function typeCalendrier(url) {
  if (/\/calendar\/export_execute\.php/i.test(url)) return 'moodle';
  if (/ade|anonymous_cal|hyperplanning|celcat|edt|emploi/i.test(url)) return 'edt';
  return 'autre';
}

// Un lien iCal contient souvent une clé : on n'en montre que le domaine.
function masquerUrl(url) { try { return new URL(String(url).replace(/^webcal:/i, 'https:')).host + '/…'; } catch { return 'lien invalide'; } }

/**
 * Agenda de la cordée : une note partagée, une ligne par créneau, lisible et modifiable à la main.
 * - 2026-11-12 14:00-16:00 Révision ENER3 @ BU (ajouté par Paulo)
 * - 2026-11-15 Rendu du rapport de TP   ← sans heure : toute la journée
 */
function lireAgendaPartage(texte) {
  const evts = [];
  for (const ligne of String(texte || '').split(/\r?\n/)) {
    const m = /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2})[:h](\d{2})(?:\s*[-–]\s*(\d{1,2})[:h](\d{2}))?)?\s+(.+?)\s*$/.exec(ligne);
    if (!m) continue;
    const [, a, mo, j, h1, m1, h2, m2, reste] = m;
    let titre = reste, lieu = '', auteur = '';
    const parAuteur = /\s*\(ajouté par ([^)]+)\)$/.exec(titre);
    if (parAuteur) { auteur = parAuteur[1].trim(); titre = titre.slice(0, parAuteur.index); }
    const at = titre.indexOf(' @ ');
    if (at >= 0) { lieu = titre.slice(at + 3).trim(); titre = titre.slice(0, at).trim(); }
    const journee = h1 === undefined;
    const debut = journee ? new Date(+a, +mo - 1, +j).getTime() : new Date(+a, +mo - 1, +j, +h1, +m1).getTime();
    const fin = journee ? debut + JOUR : h2 !== undefined ? new Date(+a, +mo - 1, +j, +h2, +m2).getTime() : debut + 3600_000;
    evts.push({ titre, lieu, auteur, debut, fin: Math.max(fin, debut), journee, ligne: ligne.trim() });
  }
  return evts;
}

function ligneAgenda({ jour, debut, fin, titre, lieu, auteur }) {
  const net = (t) => String(t || '').replace(/[\r\n]+/g, ' ').replace(/\s+@\s+/g, ' – ').trim();
  const heures = debut ? ` ${debut}${fin ? '-' + fin : ''}` : '';
  return `- ${jour}${heures} ${net(titre)}${lieu ? ' @ ' + net(lieu) : ''}${auteur ? ` (ajouté par ${net(auteur)})` : ''}`;
}

function debutSemaine(date) { const d = new Date(date); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - rangLundi(d.getDay())); return d.getTime(); }
const deuxChiffres = (n) => String(n).padStart(2, '0');
const heure = (ms) => { const d = new Date(ms); return `${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}`; };
const jourIso = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())}`; };
const estEcheance = (e) => e.type === 'moodle' || (!e.journee && e.fin === e.debut);

/** Répartit les événements qui se chevauchent dans une journée en colonnes côte à côte. */
function placerEnColonnes(evts) {
  const tries = [...evts].sort((x, y) => x.debut - y.debut || y.fin - x.fin);
  const groupes = [];
  let groupe = [], finGroupe = -Infinity;
  for (const e of tries) {
    if (e.debut >= finGroupe && groupe.length) { groupes.push(groupe); groupe = []; }
    groupe.push(e); finGroupe = Math.max(finGroupe, e.fin);
  }
  if (groupe.length) groupes.push(groupe);
  const places = [];
  for (const g of groupes) {
    const colonnes = [];
    for (const e of g) {
      let c = colonnes.findIndex((fin) => fin <= e.debut);
      if (c < 0) { c = colonnes.length; colonnes.push(0); }
      colonnes[c] = Math.max(e.fin, e.debut + 15 * 60_000);
      places.push({ e, colonne: c });
    }
    for (const p of places.slice(-g.length)) p.colonnes = colonnes.length;
  }
  return places;
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
        // Remonter le temps : deux clics (le premier demande confirmation), puis la version part chez tous.
        if (ch.type !== 'dossier') {
          const actions = zone.createEl('div', { cls: 'cordee-commandes cordee-restaurer' });
          const proposer = (texte, hash) => {
            let arme = false;
            const bouton = boutonCordee(actions, texte, async () => {
              if (!arme) { arme = true; bouton.setText('Confirmer : remplacer la version actuelle'); bouton.setAttribute('aria-label', 'Confirmer : remplacer la version actuelle par celle-ci'); bouton.addClass?.('cordee-bouton-danger'); return; }
              bouton.disabled = true;
              try { await p.restaurer(ch.chemin, hash); if (actif()) retour.setText('Version restaurée sur cet appareil. Elle part chez les autres à la prochaine synchronisation ; l’ancienne reste dans l’historique.'); }
              catch (e) { if (actif()) retour.setText('Restauration impossible : ' + (e?.message || 'erreur inconnue')); bouton.disabled = false; }
            }, { cls: 'cordee-bouton-discret' });
          };
          if (!ch.supprime && ch.hash) proposer('Restaurer cette version', ch.hash);
          if (ch.avantHash) proposer(ch.supprime ? 'Récupérer le fichier supprimé' : 'Revenir à la version d’avant', ch.avantHash);
        }
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
      const jourTitre = tableau.createEl('div', { cls: 'cordee-section-titre' });
      jourTitre.createEl('h3', { text: 'Aujourd’hui' });
      boutonCordee(jourTitre, 'La semaine', () => plugin.ouvrirSemaine(), { cls: 'cordee-bouton-discret' });
      this.aujourdhuiEl = tableau.createEl('div', { cls: 'cordee-aujourdhui-liste' });
      this.desabonnerCalendrier = plugin.surCalendrier?.(() => this.afficherAujourdhui());
      this.chargementJour = this.afficherAujourdhui();
      const voir = tableau.createEl('div', { cls: 'cordee-section-titre' });
      this.titreAVoir = voir.createEl('h3', { text: 'À voir' });
      this.boutonToutVu = boutonCordee(voir, 'Tout marquer comme vu', () => plugin.toutMarquerVu(), { cls: 'cordee-bouton-discret' });
      this.aVoirEl = tableau.createEl('div', { cls: 'cordee-a-voir' });
      this.desabonner = plugin.abonnerStatut(() => {
        this.afficherAVoir();
        // Dans le panneau latéral, l'activité suit toute seule : nouvelle révision ou présence qui change.
        const presence = JSON.stringify(plugin.presence || []);
        if (this.revChargee !== undefined && plugin.phase !== 'synchro' && (plugin.etat.derniereRev !== this.revChargee || presence !== this.presenceChargee)) this.charger();
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
    /** La journée en un coup d'œil : cours qui restent aujourd'hui et devoirs Moodle à rendre dans la semaine. */
    async afficherAujourdhui() {
      const zone = this.aujourdhuiEl, p = this.plugin;
      if (!zone || this.detruit) return;
      const maintenant = Date.now();
      const minuit = new Date(); minuit.setHours(24, 0, 0, 0);
      let evts = [];
      try { evts = await p.evenementsEntre(maintenant, maintenant + 7 * JOUR); } catch { /* calendrier illisible : on affiche ce qu'on a */ }
      if (this.detruit) return;
      zone.empty();
      const restants = evts.filter((e) => !estEcheance(e) && e.fin > maintenant && e.debut < minuit.getTime()).slice(0, 4);
      const echeances = evts.filter((e) => estEcheance(e) && e.debut >= maintenant).slice(0, 3);
      if (!restants.length && !echeances.length) {
        zone.createEl('p', { text: p.etat.calendriers.length ? 'Plus rien de prévu aujourd’hui, et aucun devoir à rendre cette semaine.' : 'Ajoute ton emploi du temps et Moodle dans les réglages de Cordée pour voir ta journée ici.', cls: 'cordee-vide' });
        return;
      }
      for (const e of [...restants, ...echeances]) {
        const b = boutonCordee(zone, '', () => new EvenementModal(this.app, p, e).open(), { label: e.titre, cls: 'cordee-evenement-ligne' });
        b.style?.setProperty?.('--cordee-couleur', e.couleur);
        const quand = estEcheance(e) ? `À rendre ${new Date(e.debut).toLocaleDateString('fr-FR', { weekday: 'short' })} ${heure(e.debut)}` : e.journee ? 'Journée' : `${heure(e.debut)}–${heure(e.fin)}`;
        b.createEl('span', { text: quand, cls: 'cordee-evenement-heure' });
        const t = b.createEl('span', { cls: 'cordee-evenement-texte' });
        t.createEl('strong', { text: e.titre });
        if (e.lieu) t.createEl('span', { text: e.lieu, cls: 'cordee-details' });
      }
    }
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
      this.revChargee = this.plugin.etat.derniereRev; this.presenceChargee = JSON.stringify(this.plugin.presence || []);
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
          const ici = (this.plugin.presence || []).find((pr) => pr.id === membre.id);
          if (ici) { bouton.addClass?.('cordee-collegue-en-ligne'); identite.createEl('span', { text: ici.chemin ? `en ligne · sur ${nomFichier(ici.chemin)}` : 'en ligne', cls: 'cordee-en-ligne' }); }
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
    detruire() { this.detruit = true; ++this.tour; this.desabonner?.(); this.desabonnerCalendrier?.(); }
  }

  /** Toutes les versions d'une note : qui, quand, combien de lignes ; un clic compare et permet de restaurer. */
  HistoriqueModal = class extends O.Modal {
    constructor(app, plugin, chemin) { super(app); this.plugin = plugin; this.chemin = chemin; }
    async onOpen() {
      const c = this.contentEl, p = this.plugin;
      this.ferme = false;
      this.modalEl?.classList.add('cordee-tableau-modal');
      c.empty(); c.createEl('div', { text: 'HISTORIQUE', cls: 'cordee-surtitre' });
      c.createEl('h2', { text: nomFichier(this.chemin), cls: 'cordee-titre' });
      if (dossierDe(this.chemin)) c.createEl('div', { text: dossierDe(this.chemin), cls: 'cordee-details' });
      const zone = c.createEl('div', { cls: 'cordee-fichiers cordee-historique', attr: { 'aria-live': 'polite' } });
      zone.createEl('p', { text: 'Chargement des versions…', cls: 'cordee-vide' });
      if (!p.connecte()) { zone.empty(); zone.createEl('p', { text: 'Rejoins un coffre pour voir l’historique.', cls: 'cordee-vide' }); return; }
      try {
        const r = await (await p.moteur.api('GET', `/api/coffres/${p.etat.coffreId}/historique?chemin=${encodeURIComponent(this.chemin)}&limite=50`)).json();
        if (this.ferme) return;
        zone.empty();
        if (!r.changements.length) { zone.createEl('p', { text: 'Pas encore de version partagée pour cette note.', cls: 'cordee-vide' }); return; }
        const profils = new Map((r.membres || []).map((m) => [m.id, m]));
        r.changements.forEach((ch, i) => {
          const carte = boutonCordee(zone, '', () => new RevisionModal(this.app, p, ch.rev, profils.get(ch.auteurId)).open(), { label: `Comparer la révision ${ch.rev}`, cls: 'cordee-fichier' });
          afficherAvatar(carte, ch.auteur, profils.get(ch.auteurId)?.avatar);
          const contenu = carte.createEl('span', { cls: 'cordee-fichier-contenu' });
          contenu.createEl('strong', { text: `${ch.auteur || 'Membre'} · ${ilYa(ch.le)}`, cls: 'cordee-fichier-chemin' });
          contenu.createEl('span', { text: `${new Date(ch.le).toLocaleString('fr-FR')} · révision ${ch.rev}${i === 0 ? ' · version actuelle' : ''}`, cls: 'cordee-fichier-auteur' });
          const genre = ch.supprime ? 'supprime' : ch.avantHash ? 'modifie' : 'ajoute';
          carte.createEl('span', { text: { supprime: 'Supprimé', modifie: 'Modifié', ajoute: 'Créé' }[genre], cls: `cordee-type-changement cordee-type-${genre}` });
        });
        c.createEl('p', { text: 'Clique sur une version pour voir ce qui a changé et, si besoin, la restaurer.', cls: 'cordee-details' });
      } catch (erreur) { if (!this.ferme) { zone.empty(); zone.createEl('p', { text: erreur.statut === 404 ? 'L’historique demande un serveur Cordée à jour.' : expliquerErreur(erreur), cls: 'cordee-vide' }); } }
    }
    onClose() { this.ferme = true; this.contentEl.empty(); }
  };

  /** Le panneau Cordée dans la barre latérale : il reste ouvert pendant qu'on écrit. */
  if (O.ItemView) VuePanneau = class extends O.ItemView {
    constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
    getViewType() { return VUE_CORDEE; }
    getDisplayText() { return 'Cordée'; }
    getIcon() { return 'cordee-logo'; }
    async onOpen() {
      this.desabonner = this.plugin.abonnerStatut(() => {
        const connecte = this.plugin.connecte();
        if (connecte !== this.etaitConnecte) { this.etaitConnecte = connecte; this.dessiner(); }
      });
    }
    dessiner() {
      this.tableau?.detruire(); this.tableau = null;
      const c = this.contentEl; c.empty(); c.addClass?.('cordee-vue');
      if (!this.plugin.connecte()) {
        c.createEl('div', { text: 'CORDÉE', cls: 'cordee-surtitre' });
        c.createEl('p', { text: 'Ce coffre n’est pas encore partagé. Rejoins un groupe avec une invitation, ou crée un partage.', cls: 'cordee-vide' });
        boutonCordee(c, 'Configurer Cordée', () => new PanneauCordee(this.app, this.plugin).open(), { cls: 'cordee-bouton-principal' });
        return;
      }
      this.tableau = new TableauActivite(this.app, this.plugin, c, () => { const m = new PanneauCordee(this.app, this.plugin); m.open(); m.afficherReglages(); });
    }
    async onClose() { this.desabonner?.(); this.tableau?.detruire(); }
  };

  /* ---------- La semaine : emploi du temps, devoirs Moodle et agenda de la cordée ---------- */

  const decalerJours = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
  const estAujourdhui = (ms) => jourIso(ms) === jourIso(Date.now());
  const LIBELLES_SOURCE = { edt: 'Emploi du temps', moodle: 'Moodle', autre: 'Calendrier', cordee: 'Agenda de la cordée' };

  /** Dessine la semaine dans c : une grille (écran large) et une liste par jour (écran étroit), l'une ou l'autre selon la largeur. */
  dessinerSemaine = async function (c, plugin, debut, changer) {
    const jours = Array.from({ length: 7 }, (_, i) => decalerJours(debut, i));
    const finSemaine = decalerJours(debut, 7);
    const evts = await plugin.evenementsEntre(debut, finSemaine);
    c.empty(); c.addClass?.('cordee-semaine');

    const tete = c.createEl('div', { cls: 'cordee-semaine-tete' });
    const nav = tete.createEl('div', { cls: 'cordee-commandes' });
    boutonCordee(nav, '‹', () => changer(decalerJours(debut, -7)), { label: 'Semaine précédente', cls: 'cordee-bouton-discret' });
    boutonCordee(nav, 'Aujourd’hui', () => changer(debutSemaine(Date.now())), { cls: 'cordee-bouton-discret' });
    boutonCordee(nav, '›', () => changer(decalerJours(debut, 7)), { label: 'Semaine suivante', cls: 'cordee-bouton-discret' });
    const d0 = new Date(jours[0]), d6 = new Date(jours[6]);
    tete.createEl('h2', { text: `Semaine du ${d0.toLocaleDateString('fr-FR', { day: 'numeric', month: d0.getMonth() === d6.getMonth() ? undefined : 'long' })} au ${d6.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`, cls: 'cordee-titre' });
    const actions = tete.createEl('div', { cls: 'cordee-commandes' });
    boutonCordee(actions, 'Ajouter un créneau', () => new CreneauModal(plugin.app, plugin, jourIso(Math.max(debut, Date.now()))).open(), { cls: 'cordee-bouton-principal' });
    boutonCordee(actions, 'Actualiser', () => plugin.actualiserCalendriers({ forcer: true }), { cls: 'cordee-bouton-discret' });

    const legende = c.createEl('div', { cls: 'cordee-legende' });
    const sources = [...plugin.etat.calendriers.map((s) => ({ nom: s.nom, type: s.type })), { nom: 'Agenda de la cordée', type: 'cordee' }];
    for (const s of sources) { const l = legende.createEl('span', { text: s.nom, cls: 'cordee-legende-source' }); l.style?.setProperty?.('--cordee-couleur', COULEURS_CALENDRIER[s.type] || COULEURS_CALENDRIER.autre); }
    for (const s of plugin.etat.calendriers) {
      const cache = plugin.etat.cacheCalendriers[s.id];
      if (cache?.erreur) c.createEl('p', { text: `${s.nom} : ${cache.erreur}.${cache.maj ? ` Dernière version gardée (${ilYa(cache.maj)}).` : ''}`, cls: 'cordee-attention' });
    }
    if (!plugin.etat.calendriers.length) {
      const vide = c.createEl('div', { cls: 'cordee-semaine-vide' });
      vide.createEl('p', { text: 'Ajoute le lien iCal de ton emploi du temps et celui de Moodle (tes devoirs à rendre) dans les réglages de Cordée. Ils restent sur cet appareil. Les créneaux de l’agenda de la cordée, eux, sont partagés avec le groupe.', cls: 'cordee-details' });
      boutonCordee(vide, 'Ajouter mon emploi du temps', () => plugin.ouvrirReglages(), { cls: 'cordee-bouton-discret' });
    }

    const ouvrir = (e) => new EvenementModal(plugin.app, plugin, e).open();
    const touche = (e, j) => e.debut < decalerJours(j, 1) && (e.fin > j || (e.fin === e.debut && e.debut >= j));
    const enJournee = (e) => e.journee || estEcheance(e);

    // Grille : heures de 7 h à 20 h, élargies si un cours commence plus tôt ou finit plus tard.
    const horaires = evts.filter((e) => !enJournee(e));
    const hDebut = Math.min(7, ...horaires.map((e) => new Date(e.debut).getHours()));
    const hFin = Math.max(20, ...horaires.map((e) => { const d = new Date(e.fin); return d.getHours() + (d.getMinutes() ? 1 : 0); }).filter((h) => h > 0));
    const grille = c.createEl('div', { cls: 'cordee-grille' });
    grille.style?.setProperty?.('--cordee-heures', String(hFin - hDebut));
    grille.createEl('div', { cls: 'cordee-grille-coin' });
    for (const j of jours) grille.createEl('div', { text: new Date(j).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }), cls: 'cordee-grille-jour' + (estAujourdhui(j) ? ' cordee-aujourdhui' : '') });
    grille.createEl('div', { text: 'Journée', cls: 'cordee-grille-coin cordee-grille-legende' });
    for (const j of jours) {
      const cellule = grille.createEl('div', { cls: 'cordee-grille-journee' });
      for (const e of evts.filter((x) => enJournee(x) && touche(x, j))) {
        const b = boutonCordee(cellule, estEcheance(e) ? `À rendre ${heure(e.debut)} · ${e.titre}` : e.titre, () => ouvrir(e), { cls: 'cordee-pastille' + (estEcheance(e) ? ' cordee-echeance' : '') });
        b.style?.setProperty?.('--cordee-couleur', e.couleur);
      }
    }
    const heures = grille.createEl('div', { cls: 'cordee-grille-heures' });
    for (let h = hDebut; h < hFin; h++) heures.createEl('div', { text: `${h} h`, cls: 'cordee-grille-heure' });
    for (const j of jours) {
      const colonne = grille.createEl('div', { cls: 'cordee-grille-colonne' + (estAujourdhui(j) ? ' cordee-aujourdhui' : '') });
      const origine = new Date(j); origine.setHours(hDebut, 0, 0, 0);
      const fin = new Date(j); fin.setHours(hFin, 0, 0, 0);
      const etendue = fin.getTime() - origine.getTime();
      for (const { e, colonne: rang, colonnes } of placerEnColonnes(horaires.filter((x) => touche(x, j)))) {
        const de = Math.max(e.debut, origine.getTime()), a = Math.min(Math.max(e.fin, e.debut + 15 * 60_000), fin.getTime());
        const b = boutonCordee(colonne, '', () => ouvrir(e), { label: `${e.titre}, ${heure(e.debut)} à ${heure(e.fin)}${e.lieu ? ', ' + e.lieu : ''}`, cls: 'cordee-evenement' });
        if (b.style) Object.assign(b.style, { top: `${(de - origine.getTime()) / etendue * 100}%`, height: `${Math.max(3, (a - de) / etendue * 100)}%`, left: `${rang / colonnes * 100}%`, width: `${100 / colonnes}%` });
        b.style?.setProperty?.('--cordee-couleur', e.couleur);
        b.createEl('strong', { text: e.titre });
        b.createEl('span', { text: `${heure(e.debut)}–${heure(e.fin)}${e.lieu ? ' · ' + e.lieu : ''}` });
      }
      if (estAujourdhui(j) && Date.now() > origine.getTime() && Date.now() < fin.getTime()) {
        const maintenant = colonne.createEl('div', { cls: 'cordee-maintenant', attr: { 'aria-hidden': 'true' } });
        if (maintenant.style) maintenant.style.top = `${(Date.now() - origine.getTime()) / etendue * 100}%`;
      }
    }

    // Liste par jour, pour les écrans étroits (téléphone, panneau latéral).
    const liste = c.createEl('div', { cls: 'cordee-liste-semaine' });
    for (const j of jours) {
      const duJour = evts.filter((e) => touche(e, j));
      const bloc = liste.createEl('section', { cls: 'cordee-liste-jour' + (estAujourdhui(j) ? ' cordee-aujourdhui' : '') });
      bloc.createEl('h3', { text: new Date(j).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) });
      if (!duJour.length) { bloc.createEl('p', { text: 'Rien de prévu.', cls: 'cordee-vide' }); continue; }
      for (const e of duJour) {
        const b = boutonCordee(bloc, '', () => ouvrir(e), { label: e.titre, cls: 'cordee-evenement-ligne' });
        b.style?.setProperty?.('--cordee-couleur', e.couleur);
        b.createEl('span', { text: e.journee ? 'Journée' : estEcheance(e) ? `À rendre ${heure(e.debut)}` : `${heure(e.debut)}–${heure(e.fin)}`, cls: 'cordee-evenement-heure' });
        const texte = b.createEl('span', { cls: 'cordee-evenement-texte' });
        texte.createEl('strong', { text: e.titre });
        const details = [e.lieu, e.source].filter(Boolean).join(' · ');
        if (details) texte.createEl('span', { text: details, cls: 'cordee-details' });
      }
    }
    return evts;
  };

  if (O.ItemView) VueSemaine = class extends O.ItemView {
    constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.debut = debutSemaine(Date.now()); }
    getViewType() { return VUE_SEMAINE; }
    getDisplayText() { return 'Semaine'; }
    getIcon() { return 'calendar-days'; }
    async onOpen() {
      this.desabonner = this.plugin.surCalendrier(() => this.dessiner());
      this.minuteur = window.setInterval(() => this.dessiner(), 5 * 60_000); // le trait « maintenant » avance
      await this.dessiner();
    }
    async dessiner() { await dessinerSemaine(this.contentEl, this.plugin, this.debut, (d) => { this.debut = d; this.dessiner(); }); }
    async onClose() { this.desabonner?.(); window.clearInterval(this.minuteur); }
  };

  EvenementModal = class extends O.Modal {
    constructor(app, plugin, e) { super(app); this.plugin = plugin; this.e = e; }
    onOpen() {
      const c = this.contentEl, e = this.e, p = this.plugin;
      c.empty(); this.modalEl?.classList.add('cordee-tableau-modal');
      const sur = c.createEl('div', { text: (LIBELLES_SOURCE[e.type] || 'Calendrier').toUpperCase(), cls: 'cordee-surtitre' });
      sur.style?.setProperty?.('color', e.couleur);
      c.createEl('h2', { text: e.titre, cls: 'cordee-titre' });
      const date = new Date(e.debut).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      c.createEl('p', { text: e.journee ? `${date} · toute la journée` : estEcheance(e) ? `À rendre le ${date} à ${heure(e.debut)}` : `${date} · ${heure(e.debut)}–${heure(e.fin)}`, cls: 'cordee-evenement-quand' });
      if (e.lieu) c.createEl('p', { text: `Où : ${e.lieu}`, cls: 'cordee-details' });
      if (e.auteur) c.createEl('p', { text: `Ajouté par ${e.auteur}`, cls: 'cordee-details' });
      if (e.description) c.createEl('p', { text: e.description, cls: 'cordee-evenement-description' });
      const actions = c.createEl('div', { cls: 'cordee-commandes cordee-restaurer' });
      boutonCordee(actions, 'Créer une note partagée', async () => { try { await p.creerNoteEvenement(e); this.close(); } catch (err) { new O.Notice('Cordée : ' + (err?.message || 'note impossible à créer')); } }, { cls: 'cordee-bouton-principal' });
      if (e.type === 'cordee') boutonCordee(actions, 'Ouvrir l’agenda de la cordée', async () => { await this.app.workspace.openLinkText(NOTE_AGENDA, '', false); this.close(); }, { cls: 'cordee-bouton-discret' });
      else boutonCordee(actions, 'Proposer ce créneau à la cordée', () => { this.close(); new CreneauModal(this.app, p, jourIso(e.debut), { titre: e.titre, debut: e.journee ? '' : heure(e.debut), fin: e.journee || estEcheance(e) ? '' : heure(e.fin), lieu: e.lieu }).open(); }, { cls: 'cordee-bouton-discret' });
    }
    onClose() { this.contentEl.empty(); }
  };

  CreneauModal = class extends O.Modal {
    constructor(app, plugin, jour, valeurs = {}) { super(app); this.plugin = plugin; this.valeurs = { jour: jour || jourIso(Date.now()), titre: '', debut: '', fin: '', lieu: '', ...valeurs }; }
    onOpen() {
      const c = this.contentEl, v = this.valeurs, p = this.plugin;
      c.empty(); this.modalEl?.classList.add('cordee-tableau-modal');
      c.createEl('div', { text: 'AGENDA DE LA CORDÉE', cls: 'cordee-surtitre' });
      c.createEl('h2', { text: 'Ajouter un créneau', cls: 'cordee-titre' });
      c.createEl('p', { text: 'Il apparaît dans la semaine de chaque membre (révision, projet, rendu…).', cls: 'cordee-details' });
      const formulaire = c.createEl('div', { cls: 'cordee-formulaire' });
      const champ = (libelle, cle, type, attr = {}) => {
        const l = formulaire.createEl('label', { cls: 'cordee-champ' });
        l.createEl('span', { text: libelle });
        const input = l.createEl('input', { attr: { type, value: v[cle] || '', ...attr } });
        input.value = v[cle] || '';
        input.addEventListener?.('input', () => { v[cle] = input.value; });
        this.champs = { ...(this.champs || {}), [cle]: input };
        return input;
      };
      champ('Quoi', 'titre', 'text', { placeholder: 'Révision ENER3', maxlength: '120' });
      champ('Jour', 'jour', 'date');
      champ('Début (facultatif)', 'debut', 'time');
      champ('Fin (facultatif)', 'fin', 'time');
      champ('Où (facultatif)', 'lieu', 'text', { placeholder: 'BU, salle, en ligne…', maxlength: '80' });
      const retour = c.createEl('p', { cls: 'cordee-details', attr: { role: 'status' } });
      const actions = c.createEl('div', { cls: 'cordee-commandes cordee-restaurer' });
      boutonCordee(actions, 'Ajouter à l’agenda', async () => {
        for (const [cle, input] of Object.entries(this.champs || {})) if (typeof input.value === 'string') v[cle] = input.value;
        if (!v.titre.trim()) { retour.setText('Indique ce qui est prévu.'); return; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v.jour)) { retour.setText('Choisis un jour.'); return; }
        if (v.fin && !v.debut) { retour.setText('Indique aussi l’heure de début.'); return; }
        if (v.debut && v.fin && v.fin <= v.debut) { retour.setText('La fin doit être après le début.'); return; }
        try { await p.ajouterCreneau({ jour: v.jour, debut: v.debut, fin: v.fin, titre: v.titre, lieu: v.lieu }); new O.Notice('Cordée : créneau ajouté à l’agenda de la cordée.'); this.close(); }
        catch (err) { retour.setText('Ajout impossible : ' + (err?.message || 'erreur inconnue')); }
      }, { cls: 'cordee-bouton-principal' });
    }
    onClose() { this.contentEl.empty(); }
  };

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
    /** Calendriers iCal de cet appareil : emploi du temps, Moodle… Les liens ne quittent jamais l'appareil. */
    afficherCalendriers(c, rafraichir) {
      const p = this.plugin;
      c.createEl('h3', { text: 'Calendriers' });
      c.createEl('p', { text: 'Colle le lien iCal de ton emploi du temps (ADE, Hyperplanning…) et celui de Moodle (Calendrier → Exporter le calendrier → Obtenir l’adresse du calendrier) : tes cours et tes devoirs à rendre s’affichent dans la vue Semaine. Ces liens restent sur cet appareil et ne sont jamais partagés avec la cordée.', cls: 'cordee-details' });
      for (const s of p.etat.calendriers) {
        const cache = p.etat.cacheCalendriers[s.id];
        const etat = cache?.erreur ? `Erreur : ${cache.erreur}` : cache?.maj ? `${cache.evenements.length} événements · mis à jour ${ilYa(cache.maj)}` : 'Pas encore lu';
        new O.Setting(c).setName(`${s.nom} · ${{ edt: 'emploi du temps', moodle: 'Moodle', autre: 'calendrier' }[s.type] || 'calendrier'}`).setDesc(`${masquerUrl(s.url)} · ${etat}`)
          .addButton((b) => b.setButtonText('Retirer').onClick(async () => { await p.retirerCalendrier(s.id); rafraichir(); }));
      }
      const f = this.formCalendrier || (this.formCalendrier = { nom: '', url: '' });
      new O.Setting(c).setName('Nom').setDesc('Par exemple : Emploi du temps, Moodle').addText((t) => t.setPlaceholder('Emploi du temps').setValue(f.nom).onChange((v) => { f.nom = v; }));
      new O.Setting(c).setName('Lien iCal').setDesc('Commence par https:// ou webcal://. Masqué à l’écran : il contient souvent une clé personnelle.').addText((t) => { t.inputEl.type = 'password'; t.setPlaceholder('https://…').setValue(f.url).onChange((v) => { f.url = v; }); });
      new O.Setting(c).addButton((b) => b.setButtonText('Ajouter le calendrier').setCta().onClick(async () => {
        try {
          const s = await p.ajouterCalendrier(f.nom, f.url);
          const cache = p.etat.cacheCalendriers[s.id];
          new O.Notice(cache?.erreur ? `Cordée : « ${s.nom} » ajouté, mais lecture impossible (${cache.erreur}).` : `Cordée : ${cache?.evenements?.length || 0} événements trouvés dans « ${s.nom} ».`);
          this.formCalendrier = { nom: '', url: '' };
          rafraichir();
        } catch (e) { new O.Notice('Cordée : ' + e.message); }
      }));
      new O.Setting(c).setName('La semaine').setDesc('Cours, devoirs Moodle et agenda de la cordée au même endroit.').addButton((b) => b.setButtonText('Ouvrir la semaine').onClick(() => p.ouvrirSemaine()));
    }
    hide() { this.nettoyer(); }
    afficherDans(c, rafraichir) {
      const p = this.plugin, e = p.etat, f = this.form;
      this.nettoyer();
      c.empty();
      afficherReglagesMoodle(c, p);
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
        this.afficherCalendriers(c, rafraichir);
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

/* ---------- Moodle ---------- */

const TAILLE_MAX_MOODLE = 50 * 1024 * 1024;
const DELAI_MOODLE = 6 * 3600_000;
const AIDE_JETON_MOODLE = 'Ton Moodle utilise peut-être la connexion de l’université : copie le jeton depuis Préférences → Clés de sécurité (« Moodle mobile web service »).';

function nomMoodle(valeur, repli = 'Sans nom') {
  // Les crochets et la barre verticale sont aussi retirés pour garder des liens Obsidian valides.
  let nom = String(valeur || '').normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*\[\]#^]/g, '-').replace(/\.{2,}/g, '-').replace(/^[. ]+|[. ]+$/g, '').slice(0, 100).replace(/[. ]+$/g, '');
  if (!nom) nom = repli;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(nom)) nom = '_' + nom;
  return nom;
}

function dossierMoodle(valeur) {
  const parties = String(valeur || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parties.length || parties.some((p) => p.trim() === '.' || p.trim() === '..')) throw new Error('Choisis un dossier du coffre, sans « .. ».');
  return parties.map((p) => nomMoodle(p)).join('/');
}

function siteMoodle(valeur) {
  try {
    const u = new URL(String(valeur || '').trim());
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error();
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch { throw new Error('Indique l’adresse HTTPS de ton Moodle, par exemple https://moodle.exemple.fr.'); }
}

function copieMoodle(chemin, numero = 1) {
  const point = chemin.lastIndexOf('.'), slash = chemin.lastIndexOf('/');
  const suffixe = numero === 1 ? ' (Moodle)' : ` (Moodle ${numero})`;
  return point > slash ? chemin.slice(0, point) + suffixe + chemin.slice(point) : chemin + suffixe;
}

function modificationLocaleMoodle(avant, hash) { return hash !== null && (!avant?.hash || avant.hash !== hash); }
function doitTelechargerMoodle(fichier, avant, existe = true) {
  return fichier.filesize <= TAILLE_MAX_MOODLE && (!avant || !existe || avant.source !== fichier.chemin || avant.timemodified !== fichier.timemodified || avant.filesize !== fichier.filesize);
}

function fichiersMoodle(sections, destination, coursId) {
  const racine = dossierMoodle(destination), sortie = [], occupes = new Set([`${racine}/Cours.md`.toLowerCase()]);
  const sectionsVues = new Set();
  for (const section of sections || []) {
    let nomSection = nomMoodle(section.name, 'Général');
    if (sectionsVues.has(nomSection.toLowerCase())) nomSection += ` (${nomMoodle(section.id)})`;
    sectionsVues.add(nomSection.toLowerCase());
    for (const module of section.modules || []) {
      if (!['resource', 'folder'].includes(module.modname)) continue;
      for (const contenu of module.contents || []) {
        if (contenu.type !== 'file' || !contenu.fileurl || !contenu.filename) continue;
        const taille = Number(contenu.filesize), modifie = Number(contenu.timemodified || 0);
        if (!Number.isFinite(taille) || taille < 0 || !Number.isFinite(modifie)) continue;
        const sousDossiers = String(contenu.filepath || '').split('/').filter((p) => p && p !== '.' && p !== '..').map((p) => nomMoodle(p));
        const base = [racine, nomSection, ...sousDossiers, nomMoodle(contenu.filename)].join('/');
        let chemin = base, numero = 1;
        // Deux activités peuvent proposer « cours.pdf » dans la même section, même sous Windows.
        while (occupes.has(chemin.toLowerCase())) chemin = copieMoodle(base, numero++);
        occupes.add(chemin.toLowerCase());
        sortie.push({ cle: JSON.stringify([coursId, module.id, contenu.filepath || '/', contenu.filename]), section: nomSection, chemin, fileurl: contenu.fileurl, filename: nomMoodle(contenu.filename), filesize: taille, timemodified: modifie });
      }
    }
  }
  return sortie;
}

function indexMoodle(cours, sections, fichiers, cache) {
  const lignes = [`# ${nomMoodle(cours.fullname || cours.shortname)}`, '', 'Fichiers récupérés depuis Moodle. Ce dossier est partagé avec la cordée sauf s’il figure dans « Dossiers non partagés ».', ''];
  const titres = new Set(fichiers.map((f) => f.section));
  for (const section of sections || []) titres.add(nomMoodle(section.name, 'Général'));
  for (const titre of titres) {
    lignes.push(`## ${titre}`, '');
    const presents = fichiers.filter((f) => f.section === titre);
    for (const f of presents) {
      const recu = cache[f.cle];
      lignes.push(recu && recu.source === f.chemin ? `- [[${recu.chemin}|${f.filename}]]` : `- ${f.filename} — ${f.filesize > TAILLE_MAX_MOODLE ? 'dépasse 50 Mo' : 'pas encore récupéré'}`);
    }
    if (!presents.length) lignes.push('Aucun fichier de ressource ou de dossier.');
    lignes.push('');
  }
  return lignes.join('\n');
}

function erreurMoodle(code) {
  const message = ['invalidtoken', 'accessexception', 'requireloginerror', 'servicenotavailable', 'webservice_access_exception'].includes(code)
    ? 'Ton jeton Moodle est invalide ou expiré. Copie un nouveau jeton dans Préférences → Clés de sécurité.'
    : 'Moodle refuse cette demande. Vérifie que les services de l’application mobile sont activés pour ton compte.';
  return Object.assign(new Error(message), { codeMoodle: code });
}

function markdownMoodle(html) {
  const entites = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', agrave: 'à', ecirc: 'ê', ccedil: 'ç', ocirc: 'ô', ugrave: 'ù', rsquo: '’', ndash: '–', mdash: '—' };
  let texte = String(html || '').slice(0, 500_000);
  // Décoder avant de retirer les balises empêche une balise encodée de réapparaître dans la note.
  for (let n = 0; n < 4; n++) texte = texte.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tout, cle) => {
    if (cle[0] !== '#') return entites[cle.toLowerCase()] ?? tout;
    const point = cle[1]?.toLowerCase() === 'x' ? parseInt(cle.slice(2), 16) : Number(cle.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  });
  texte = texte.replace(/<!--[^]*?(?:-->|$)/g, '').replace(/<(script|style|iframe|object|svg|math)\b[^>]*>[^]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<\s*br\b[^>]*>/gi, '\n').replace(/<\s*li\b[^>]*>/gi, '\n- ').replace(/<\/?(?:p|div|ul|ol|h[1-6]|tr|blockquote)\b[^>]*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '').replace(/</g, '‹').replace(/>/g, '›').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/([\\`*_\[\]!|#])/g, '\\$1').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return texte;
}

function texteMoodle(html) { return markdownMoodle(html).replace(/\\([\\`*_\[\]!|#])/g, '$1'); }

function devoirMoodle(devoir, cours, statut, site) {
  const tentative = statut.lastattempt || statut.status || {};
  const debut = Number(tentative.extensionduedate || devoir.duedate) * 1000;
  if (!Number.isFinite(debut) || debut <= 0 || !Number.isSafeInteger(Number(devoir.cmid))) return null;
  return { titre: texteMoodle(devoir.name).replace(/\s+/g, ' '), cours: texteMoodle(cours.shortname || cours.fullname).replace(/\s+/g, ' '), debut,
    rendu: tentative.submission?.status === 'submitted' || tentative.teamsubmission?.status === 'submitted',
    url: siteMoodle(site) + '/mod/assign/view.php?id=' + Number(devoir.cmid) };
}

function noteAnnoncesMoodle(cours, discussions) {
  const lignes = [`# Annonces — ${nomMoodle(cours.shortname || cours.fullname)}`, '', 'Les 20 dernières annonces du cours. Ce fichier est partagé avec la cordée.', ''];
  const uniques = new Map();
  for (const d of discussions) uniques.set(d.discussion || d.id, d);
  const dernieres = [...uniques.values()].sort((a, b) => Number(b.created || b.timemodified) - Number(a.created || a.timemodified)).slice(0, 20);
  for (const d of dernieres) {
    const titre = markdownMoodle(d.subject || d.name || 'Annonce').replace(/\s+/g, ' ');
    const auteur = markdownMoodle(d.userfullname || 'Équipe du cours').replace(/\s+/g, ' ');
    const le = new Date(Number(d.created || d.timemodified) * 1000);
    lignes.push(`## ${titre}`, '', `${Number.isFinite(le.getTime()) ? le.toLocaleString('fr-FR') : 'Date non précisée'} · ${auteur}`, '', markdownMoodle(d.message), '');
  }
  if (!dernieres.length) lignes.push('Aucune annonce pour le moment.', '');
  return lignes.join('\n');
}

Object.assign(CordeePlugin.prototype, {
  initialiserMoodle() {
    const m = this.etat.moodle || {};
    this.etat.moodle = { ...m, site: m.site || '', jeton: m.jeton || '', selections: { ...(m.selections || {}) }, fichiers: { ...(m.fichiers || {}) }, index: { ...(m.index || {}) }, annonces: { ...(m.annonces || {}) }, devoirs: [...(m.devoirs || [])] };
  },
  demarrerMoodle() {
    const lancer = () => {
      const m = this.etat.moodle;
      if (m.jeton && Date.now() - (m.derniereRecuperation || 0) >= DELAI_MOODLE) this.recupererMoodle().catch((e) => new O.Notice(e.message));
    };
    lancer();
    this.registerInterval(window.setInterval(lancer, DELAI_MOODLE));
  },
  async requeteMoodle(url, body) {
    let r;
    try { r = await O.requestUrl({ url, method: 'POST', contentType: 'application/x-www-form-urlencoded', body: new URLSearchParams(body).toString(), throw: false }); }
    catch { throw new Error('Ton site Moodle est injoignable. Vérifie son adresse et ta connexion, puis réessaie.'); }
    if ([401, 403].includes(r.status)) throw erreurMoodle('invalidtoken');
    if (r.status >= 300) throw new Error('Ton site Moodle est injoignable. Vérifie son adresse et ta connexion, puis réessaie.');
    let json;
    try { json = r.json; } catch { /* une page de connexion n’est pas une réponse de l’API */ }
    if (!json || typeof json !== 'object') throw new Error('Cette adresse ne répond pas comme un site Moodle. Vérifie l’adresse du site.');
    return json;
  },
  async apiMoodle(fonction, parametres = {}, acces = this.etat.moodle) {
    if (!acces.jeton) throw erreurMoodle('invalidtoken');
    const json = await this.requeteMoodle(siteMoodle(acces.site) + '/webservice/rest/server.php', { ...parametres, wstoken: acces.jeton, wsfunction: fonction, moodlewsrestformat: 'json' });
    if (json.exception || json.errorcode || json.error) throw erreurMoodle(json.errorcode);
    return json;
  },
  async connecterMoodle(site, jeton, identifiant, motDePasse) {
    if (this.moodleEnCours) throw new Error('Attends la fin de la récupération avant de changer de compte Moodle.');
    const ancien = this.etat.moodle, tentative = this.moodleConnexion = (this.moodleConnexion || 0) + 1;
    const acces = { site: siteMoodle(site), jeton: String(jeton || '').trim() };
    if (!acces.jeton && motDePasse) {
      let reponse;
      try { reponse = await this.requeteMoodle(acces.site + '/login/token.php', { username: identifiant, password: motDePasse, service: 'moodle_mobile_app' }); }
      catch (e) { if (/jeton/.test(e.message)) throw new Error(AIDE_JETON_MOODLE); throw e; }
      finally { motDePasse = ''; }
      if (!reponse.token) throw new Error(AIDE_JETON_MOODLE);
      acces.jeton = reponse.token;
    }
    if (!acces.jeton) acces.jeton = this.etat.moodle.site === acces.site ? this.etat.moodle.jeton : '';
    const info = await this.apiMoodle('core_webservice_get_site_info', {}, acces);
    const cours = await this.apiMoodle('core_enrol_get_users_courses', { userid: info.userid }, acces);
    if (!Array.isArray(cours)) throw erreurMoodle();
    if (this.arret || tentative !== this.moodleConnexion || ancien !== this.etat.moodle) throw new Error('La connexion à Moodle a été arrêtée.');
    if (this.moodleEnCours) throw new Error('Attends la fin de la récupération avant de changer de compte Moodle.');
    const memeCompte = ancien.site === acces.site && ancien.userid === info.userid;
    if (this.modalNotesMoodle) { const modal = this.modalNotesMoodle; modal.onClose(); modal.close?.(); }
    this.etat.moodle = { ...(memeCompte ? ancien : { selections: {}, fichiers: {}, index: {}, annonces: {}, devoirs: [] }), ...acces, userid: info.userid, prenom: String(info.firstname || 'toi').slice(0, 60) };
    await this.saveData(this.etat);
    return { prenom: this.etat.moodle.prenom, cours };
  },
  async deconnecterMoodle() {
    // Remplacer l’objet invalide aussi les réponses d’une récupération déjà partie.
    this.moodleConnexion = (this.moodleConnexion || 0) + 1;
    if (this.modalNotesMoodle) { const modal = this.modalNotesMoodle; modal.onClose(); modal.close?.(); }
    this.etat.moodle = { site: this.etat.moodle.site, jeton: '', selections: {}, fichiers: {}, index: {}, annonces: {}, devoirs: [] };
    await this.saveData(this.etat);
  },
  async coursMoodle() {
    const m = this.etat.moodle;
    if (!m.userid) throw erreurMoodle('invalidtoken');
    const cours = await this.apiMoodle('core_enrol_get_users_courses', { userid: m.userid });
    if (!Array.isArray(cours)) throw erreurMoodle();
    return cours;
  },
  devoirsMoodle() {
    if (!this.etat.moodle.jeton) return [];
    // L’état de rendu est personnel : ce cache ne rejoint jamais l’index partagé des cours.
    return this.etat.moodle.devoirs.filter((d) => d.debut > Date.now()).map((d) => ({ ...d }));
  },
  async actualiserDevoirsMoodle(cours, acces) {
    if (!cours.length) { acces.devoirs = []; return; }
    const parametres = Object.fromEntries(cours.map((c, i) => [`courseids[${i}]`, c.id]));
    const reponse = await this.apiMoodle('mod_assign_get_assignments', parametres, acces);
    if (!Array.isArray(reponse.courses)) throw erreurMoodle();
    const devoirs = [];
    for (const c of reponse.courses) {
      const inscrit = cours.find((coursActuel) => Number(coursActuel.id) === Number(c.id));
      if (!inscrit) continue;
      for (const devoir of c.assignments || []) {
        if (this.arret || acces !== this.etat.moodle) throw new Error('La récupération Moodle a été arrêtée.');
        if (!Number(devoir.duedate)) continue;
        const statut = await this.apiMoodle('mod_assign_get_submission_status', { assignid: devoir.id, userid: acces.userid }, acces);
        const entree = devoirMoodle(devoir, inscrit, statut, acces.site);
        if (entree && entree.debut > Date.now()) devoirs.push(entree);
      }
    }
    if (this.arret || acces !== this.etat.moodle) throw new Error('La récupération Moodle a été arrêtée.');
    acces.devoirs = devoirs.sort((a, b) => a.debut - b.debut);
  },
  async actualiserAnnoncesMoodle(cours, destination, acces) {
    const forums = await this.apiMoodle('mod_forum_get_forums_by_courses', { 'courseids[0]': cours.id }, acces);
    if (!Array.isArray(forums)) throw erreurMoodle();
    const discussions = [];
    for (const forum of forums) {
      if (this.arret || acces !== this.etat.moodle) throw new Error('La récupération Moodle a été arrêtée.');
      if (forum.type !== 'news' || Number(forum.course) !== Number(cours.id)) continue;
      const reponse = await this.apiMoodle('mod_forum_get_forum_discussions', { forumid: forum.id, sortorder: 3, page: 0, perpage: 20 }, acces);
      if (!Array.isArray(reponse.discussions)) throw erreurMoodle();
      discussions.push(...reponse.discussions);
    }
    const buf = versBuffer(noteAnnoncesMoodle(cours, discussions));
    acces.annonces[cours.id] = await this.ecrireMoodle(destination + '/Annonces.md', buf, acces.annonces[cours.id], acces);
  },
  async notesMoodle(coursId, acces = this.etat.moodle) {
    // Les notes restent dans la fenêtre : aucun cache persistant ni fichier n’est créé.
    const reponse = await this.apiMoodle('gradereport_user_get_grade_items', { courseid: coursId, userid: acces.userid }, acces);
    if (!Array.isArray(reponse.usergrades)) throw erreurMoodle();
    if (this.arret || acces !== this.etat.moodle) throw new Error('La lecture des notes Moodle a été arrêtée.');
    return reponse.usergrades.filter((u) => Number(u.userid) === Number(acces.userid)).flatMap((u) => (u.gradeitems || []).filter((item) => !item.itemhidden && !item.hidden).map((item) => ({
      titre: texteMoodle(item.itemname || (item.itemtype === 'course' ? 'Total du cours' : 'Évaluation')),
      note: texteMoodle(item.gradeformatted || 'Pas encore de note'), bareme: texteMoodle(item.rangeformatted || ''),
    })));
  },
  async telechargerMoodle(fichier, acces) {
    let u;
    try {
      u = new URL(fichier.fileurl);
      // Une réponse distante ne doit jamais envoyer le jeton à un autre site.
      if (u.protocol !== 'https:' || u.origin !== new URL(acces.site).origin || u.username || u.password) throw new Error();
    } catch { throw new Error('Un fichier Moodle pointe vers un autre site : il n’a pas été récupéré.'); }
    u.searchParams.delete('wstoken'); u.searchParams.set('token', acces.jeton); u.hash = '';
    let r;
    try { r = await O.requestUrl({ url: u.href, throw: false }); }
    catch { throw new Error('Ton site Moodle est injoignable. Vérifie ta connexion, puis réessaie.'); }
    if ([401, 403].includes(r.status)) throw erreurMoodle('invalidtoken');
    if (r.status >= 300) throw new Error('Moodle n’a pas pu envoyer ce fichier. Réessaie plus tard.');
    const buf = r.arrayBuffer;
    if (!(buf?.byteLength >= 0)) throw new Error('Moodle n’a pas envoyé de fichier.');
    if (buf.byteLength > TAILLE_MAX_MOODLE) throw new Error('Un fichier dépasse 50 Mo : il n’a pas été enregistré.');
    if (String(r.headers?.['content-type'] || '').includes('text/html') && !/\.html?$/i.test(fichier.filename)) throw erreurMoodle('invalidtoken');
    // Moodle renvoie parfois son erreur JSON avec un statut HTTP 200.
    if (String(r.headers?.['content-type'] || '').includes('application/json')) {
      try { const j = JSON.parse(versTexte(buf)); if (j.exception || j.errorcode) throw erreurMoodle(j.errorcode); }
      catch (e) { if (!(e instanceof SyntaxError)) throw e; }
    }
    return buf;
  },
  trouverMoodle(chemin) {
    const vault = this.app.vault;
    return vault.getAbstractFileByPath(chemin) || (vault.getAllLoadedFiles?.() || []).find((f) => f.path.toLowerCase() === chemin.toLowerCase()) || null;
  },
  async ecrireMoodle(source, buf, avant, acces) {
    const vault = this.app.vault;
    if (this.arret || acces !== this.etat.moodle) throw new Error('La récupération Moodle a été arrêtée.');
    if (dansConfiguration(source, vault.configDir)) throw new Error('Choisis un dossier en dehors de la configuration d’Obsidian.');
    await this.moteur.fichiers.creerDossier(dossierDe(source));
    const hash = await empreinte(buf);
    let chemin = avant?.source === source ? avant.chemin : source, f = this.trouverMoodle(chemin);
    if (f) {
      const mtime = f.stat?.mtime;
      const local = f instanceof O.TFile ? await empreinte(await vault.readBinary(f)) : '';
      if (f.stat?.mtime !== mtime || modificationLocaleMoodle(avant?.chemin === chemin ? avant : null, local)) {
        let n = 1;
        do { chemin = copieMoodle(source, n++); } while (this.trouverMoodle(chemin) || await vault.adapter.exists(chemin));
        f = null;
      }
    } else if (await vault.adapter.exists(chemin)) {
      // Un fichier absent de l’index peut déjà exister sur disque : on le préserve aussi.
      let n = 1;
      do { chemin = copieMoodle(source, n++); } while (this.trouverMoodle(chemin) || await vault.adapter.exists(chemin));
    }
    if (this.arret || acces !== this.etat.moodle) throw new Error('La récupération Moodle a été arrêtée.');
    if (f) await vault.modifyBinary(f, buf);
    else await vault.createBinary(chemin, buf);
    return { source, chemin, hash };
  },
  async recupererMoodle() {
    if (this.moodleEnCours) return this.moodleEnCours;
    const m = this.etat.moodle;
    this.moodleEnCours = (async () => {
      const cours = await this.coursMoodle();
      let total = 0, tropGros = 0;
      const avertissements = [];
      try { await this.actualiserDevoirsMoodle(cours, m); }
      catch { avertissements.push('Les devoirs n’ont pas pu être actualisés. Le dernier état connu est conservé sur cet appareil.'); }
      if (this.arret || m !== this.etat.moodle) throw new Error('La récupération Moodle a été arrêtée.');
      for (const coursActuel of cours) {
        const choix = m.selections[coursActuel.id];
        if (!choix?.copier) continue;
        const destination = dossierMoodle(choix.dossier);
        const sections = await this.apiMoodle('core_course_get_contents', { courseid: coursActuel.id }, m);
        if (!Array.isArray(sections)) throw erreurMoodle();
        const fichiers = fichiersMoodle(sections, destination, coursActuel.id);
        let nombre = 0;
        for (const fichier of fichiers) {
          if (fichier.filesize > TAILLE_MAX_MOODLE) { tropGros++; continue; }
          const avant = m.fichiers[fichier.cle];
          if (!doitTelechargerMoodle(fichier, avant, !!(avant && this.trouverMoodle(avant.chemin)))) continue;
          const buf = await this.telechargerMoodle(fichier, m);
          const recu = await this.ecrireMoodle(fichier.chemin, buf, avant, m);
          m.fichiers[fichier.cle] = { ...recu, timemodified: fichier.timemodified, filesize: fichier.filesize };
          await this.saveData(this.etat);
          nombre++; total++;
        }
        const note = versBuffer(indexMoodle(coursActuel, sections, fichiers, m.fichiers));
        m.index[coursActuel.id] = await this.ecrireMoodle(destination + '/Cours.md', note, m.index[coursActuel.id], m);
        try { await this.actualiserAnnoncesMoodle(coursActuel, destination, m); }
        catch { avertissements.push(`Les annonces de ${nomMoodle(coursActuel.shortname || coursActuel.fullname)} n’ont pas pu être actualisées.`); }
        await this.saveData(this.etat);
        if (nombre) new O.Notice(`${nombre} ${nombre > 1 ? 'nouveaux fichiers' : 'nouveau fichier'} dans ${nomMoodle(coursActuel.shortname || coursActuel.fullname)}`);
      }
      if (m !== this.etat.moodle) throw new Error('La récupération Moodle a été arrêtée.');
      m.derniereRecuperation = Date.now();
      m.avertissements = avertissements;
      await this.saveData(this.etat);
      if (tropGros) new O.Notice(`${tropGros} fichier(s) Moodle dépassent 50 Mo et n’ont pas été récupérés.`);
      if (avertissements.length) new O.Notice(avertissements.join(' '));
      return total;
    })();
    try { return await this.moodleEnCours; } finally { this.moodleEnCours = null; }
  },
});

function afficherReglagesMoodle(c, p) {
  const zone = c.createEl('div', { cls: 'cordee-moodle' });
  zone.createEl('h3', { text: 'Moodle' });
  zone.createEl('p', { text: 'Récupère tes PDF de cours, TD, TP et sujets dans le coffre. Les fichiers choisis sont partagés avec la cordée, sauf dans les « Dossiers non partagés ». Le jeton reste dans la configuration de cet appareil.', cls: 'cordee-details' });
  const retour = zone.createEl('p', { cls: 'cordee-details', attr: { role: 'status', 'aria-live': 'polite' } });
  let adresse = p.etat.moodle.site, identifiant = '', jeton, motDePasse;
  new O.Setting(zone).setName('Adresse du site Moodle').addText((t) => t.setPlaceholder('https://moodle.exemple.fr').setValue(adresse).onChange((v) => { adresse = v; }));
  new O.Setting(zone).setName('Identifiant Moodle').setDesc('Facultatif si tu colles un jeton.').addText((t) => t.onChange((v) => { identifiant = v; }));
  new O.Setting(zone).setName('Mot de passe Moodle').setDesc('Utilisé une seule fois pour obtenir un jeton, jamais enregistré.').addText((t) => { motDePasse = t; t.inputEl.type = 'password'; t.inputEl.autocomplete = 'off'; });
  new O.Setting(zone).setName('Jeton Moodle').setDesc('Ou copie le jeton depuis Moodle → Préférences → Clés de sécurité. Un champ vide conserve le jeton déjà enregistré pour ce site.').addText((t) => { jeton = t; t.inputEl.type = 'password'; t.inputEl.autocomplete = 'off'; t.setPlaceholder(p.etat.moodle.jeton ? 'Jeton enregistré sur cet appareil' : 'Coller un jeton'); });
  new O.Setting(zone).addButton((b) => b.setButtonText('Tester').onClick(async () => {
    b.setDisabled(true);
    const secret = motDePasse.inputEl.value || '', cle = jeton.inputEl.value || '';
    motDePasse.setValue(''); jeton.setValue('');
    try { const resultat = await p.connecterMoodle(adresse, cle, identifiant, secret); retour.setText(`Connecté en tant que ${resultat.prenom} · ${resultat.cours.length} cours`); }
    catch (e) { retour.setText(e.message); }
    finally { b.setDisabled(false); }
  })).addButton((b) => b.setButtonText('Cours Moodle').onClick(() => new CoursMoodleModal(p.app, p).open()))
    .addButton((b) => b.setButtonText('Mes notes Moodle').onClick(() => new NotesMoodleModal(p.app, p).open()))
    .addButton((b) => b.setButtonText('Se déconnecter de Moodle').onClick(async () => { await p.deconnecterMoodle(); motDePasse.setValue(''); jeton.setValue(''); retour.setText('Déconnecté de Moodle. Les fichiers déjà récupérés restent dans le coffre.'); }));
}

let CoursMoodleModal;
if (O) CoursMoodleModal = class extends O.Modal {
  constructor(app, plugin) { super(app); this.plugin = plugin; }
  async onOpen() {
    const c = this.contentEl, p = this.plugin, m = p.etat.moodle;
    const destinationsInvalides = new Set();
    c.empty(); c.createEl('h2', { text: 'Cours Moodle' });
    c.createEl('p', { text: 'Chaque dossier choisi est partagé avec la cordée, sauf s’il est dans « Dossiers non partagés ». Les fichiers des ressources, dossiers et annonces Moodle sont copiés. Tes rendus et tes notes restent sur cet appareil. Récupération automatique toutes les 6 h quand Obsidian est ouvert.', cls: 'cordee-details' });
    const retour = c.createEl('p', { text: 'Chargement des cours…', attr: { role: 'status', 'aria-live': 'polite' } });
    try {
      const cours = await p.coursMoodle();
      if (this.ferme || m !== p.etat.moodle) return;
      retour.setText(cours.length ? '' : 'Tu n’as aucun cours Moodle pour le moment.');
      const noms = cours.map((v) => nomMoodle(v.shortname || v.fullname));
      for (const coursActuel of cours) {
        const nom = nomMoodle(coursActuel.shortname || coursActuel.fullname);
        const defaut = 'Moodle/' + nom + (noms.filter((v) => v.toLowerCase() === nom.toLowerCase()).length > 1 ? ` (${nomMoodle(coursActuel.id)})` : '');
        const choix = m.selections[coursActuel.id] || (m.selections[coursActuel.id] = { copier: false, dossier: defaut });
        const bloc = c.createEl('div', { cls: 'cordee-moodle-cours' });
        bloc.createEl('h3', { text: coursActuel.fullname || coursActuel.shortname });
        const label = bloc.createEl('label');
        const caseCopier = label.createEl('input', { attr: { type: 'checkbox', 'aria-label': `Copier dans le coffre : ${nom}` } });
        caseCopier.checked = !!choix.copier;
        label.createEl('span', { text: ' Copier dans le coffre' });
        caseCopier.onchange = async () => { if (m !== p.etat.moodle) return; choix.copier = caseCopier.checked; await p.saveData(p.etat); };
        new O.Setting(bloc).setName(`Dossier de destination · ${nom}`).addText((t) => t.setValue(choix.dossier).onChange(async (v) => {
          try {
            const dossier = dossierMoodle(v);
            if (dansConfiguration(dossier, p.app.vault.configDir)) throw new Error('Choisis un dossier en dehors de la configuration d’Obsidian.');
            if (m !== p.etat.moodle) return;
            choix.dossier = dossier; destinationsInvalides.delete(coursActuel.id); await p.saveData(p.etat); retour.setText(`Destination : ${dossier}`);
          } catch (e) { destinationsInvalides.add(coursActuel.id); retour.setText(e.message); }
        }));
      }
      boutonCordee(c, 'Récupérer maintenant', async () => {
        if (m !== p.etat.moodle) { retour.setText('Rouvre les cours après ta reconnexion à Moodle.'); return; }
        if ([...destinationsInvalides].some((id) => m.selections[id]?.copier)) { retour.setText('Corrige le dossier de destination avant de récupérer les fichiers.'); return; }
        retour.setText('Récupération en cours…');
        try { const n = await p.recupererMoodle(); retour.setText((n ? `${n} fichier(s) récupéré(s).` : 'Tes fichiers Moodle sont à jour.') + ' ' + (m.avertissements || []).join(' ')); }
        catch (e) { retour.setText(e.message); }
      }, { cls: 'cordee-bouton-principal' });
    } catch (e) { retour.setText(e.message + ' Ouvre Réglages → Cordée → Moodle pour te connecter.'); }
  }
  onClose() { this.ferme = true; this.contentEl.empty(); }
};

let NotesMoodleModal;
if (O) NotesMoodleModal = class extends O.Modal {
  constructor(app, plugin) { super(app); this.plugin = plugin; }
  async onOpen() {
    const c = this.contentEl, p = this.plugin, acces = p.etat.moodle;
    if (p.modalNotesMoodle && p.modalNotesMoodle !== this) p.modalNotesMoodle.onClose();
    p.modalNotesMoodle = this;
    c.empty(); c.createEl('h2', { text: 'Mes notes Moodle' });
    c.createEl('p', { text: 'Visible seulement sur cet appareil. Tes notes ne sont jamais enregistrées dans le coffre ni partagées avec la cordée.', cls: 'cordee-details' });
    const retour = c.createEl('p', { text: 'Chargement des notes…', attr: { role: 'status', 'aria-live': 'polite' } });
    try {
      const cours = await p.coursMoodle();
      for (const coursActuel of cours) {
        if (this.ferme || acces !== p.etat.moodle) return;
        const notes = await p.notesMoodle(coursActuel.id, acces);
        if (this.ferme || acces !== p.etat.moodle) return;
        const bloc = c.createEl('div', { cls: 'cordee-moodle-cours' });
        bloc.createEl('h3', { text: coursActuel.shortname || coursActuel.fullname });
        if (!notes.length) bloc.createEl('p', { text: 'Pas encore de note visible dans ce cours.' });
        for (const note of notes) bloc.createEl('p', { text: `${note.titre} · ${note.note}${note.bareme ? ' · ' + note.bareme : ''}` });
      }
      if (!this.ferme && acces === p.etat.moodle) retour.setText(cours.length ? '' : 'Tu n’as aucun cours Moodle pour le moment.');
    } catch (e) { if (!this.ferme && acces === p.etat.moodle) retour.setText(e.message); }
  }
  onClose() { this.ferme = true; this.contentEl.empty(); if (this.plugin.modalNotesMoodle === this) this.plugin.modalNotesMoodle = null; }
};

/* ---------- Fin Moodle ---------- */

module.exports = CordeePlugin;
module.exports.default = CordeePlugin;
module.exports.interne = { get HistoriqueModal() { return HistoriqueModal; }, get CreneauModal() { return CreneauModal; }, get dessinerSemaine() { return dessinerSemaine; }, lireIcs, developper, lireAgendaPartage, ligneAgenda, typeCalendrier, masquerUrl, debutSemaine, placerEnColonnes, get RevisionModal() { return RevisionModal; }, VERSION, comparerVersions, lignesModifiees, couleurAuteur, ilYa, echapperCss, fusionner, Moteur, empreinte, versBuffer, versTexte, nomCopieConflit, lireInvitation, expliquerErreur, avatarValide, preparerPhoto, calculerDiff, premierBlocModifie };
Object.assign(module.exports.interne, { nomMoodle, dossierMoodle, siteMoodle, fichiersMoodle, doitTelechargerMoodle, modificationLocaleMoodle, copieMoodle, indexMoodle, get CoursMoodleModal() { return CoursMoodleModal; } });
Object.assign(module.exports.interne, { markdownMoodle, devoirMoodle, noteAnnoncesMoodle, get NotesMoodleModal() { return NotesMoodleModal; } });
