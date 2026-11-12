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
// Les vidéos de cours pèsent des centaines de Mo : elles restent sur l'appareil sauf choix contraire.
const EXT_VIDEO = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv']);
function estVideo(chemin) { return EXT_VIDEO.has(String(chemin).split('.').pop().toLowerCase()); }
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
    if (!this.indexListe) this.indexListe = new Map(this.fichiers.lister().map((x) => [x.chemin, x]));
    const f = this.indexListe.get(chemin);
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
    const pret = this.prechargements?.get(hash);
    if (pret) { this.prechargements.delete(hash); return pret; }
    const r = await this.api('GET', `${this.racine()}/blobs/${hash}`);
    return r.octets();
  }

  /** Lance à l'avance le téléchargement d'une version reçue, au plus PARALLELE à la fois. */
  precharger(c) {
    if (!c || c.type === 'dossier' || c.supprime || !c.hash || c.hash === this.etat.bases[c.chemin] || this.ignorer(c.chemin)) return;
    this.prechargements ||= new Map();
    if (this.prechargements.has(c.hash)) return;
    const promesse = this.api('GET', `${this.racine()}/blobs/${c.hash}`).then((r) => r.octets());
    promesse.catch(() => { /* l'erreur ressort au moment d'appliquer ce changement */ });
    this.prechargements.set(c.hash, promesse);
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
      let tours = 0;
      try {
        do {
          if (++tours > 5) { this.signaler('encore'); break; }
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
      const lot = [...derniers.entries()].sort((a, b) => a[1].rev - b[1].rev);
      this.indexListe = null;
      try {
        for (let i = 0; i < lot.length; i++) {
          for (let j = i; j < Math.min(lot.length, i + PARALLELE); j++) this.precharger(lot[j][1]);
          const [cle, c] = lot[i];
          if (lot.length > 10) this.signaler('progression', i + 1, lot.length);
          traites.add(cle);
          if (!this.ignorer(c.chemin)) await this.appliquerSansBloquer(c);
        }
      } finally { this.indexListe = null; this.prechargements = null; this.signaler('progression', 0, 0); }
      if (r.changements.length) this.etat.derniereRev = r.changements[r.changements.length - 1].rev;
      plus = r.plus;
      await this.sauver();
    }
    // Les changements mis de côté lors d'une synchro précédente : une nouvelle chance, sans bloquer le reste.
    try {
      for (const [cle, c] of Object.entries(this.etat.enAttente)) {
        if (traites.has(cle)) continue;
        if (this.ignorer(c.chemin)) { delete this.etat.enAttente[cle]; continue; }
        await this.appliquerSansBloquer(c);
      }
    } finally { this.indexListe = null; }
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
    const presents = new Set(), aEnvoyer = [];
    for (const f of this.fichiers.lister()) {
      if (this.ignorer(f.chemin)) continue;
      presents.add(f.chemin);
      if (f.taille > this.tailleMax) { this.signaler('fichier-trop-gros', f.chemin); continue; }
      aEnvoyer.push(f);
    }
    const changes = [];
    await enParallele(aEnvoyer, PARALLELE, async (f) => {
      const h = await this.hashFichier(f);
      if (h !== null && h !== (this.etat.bases[f.chemin] || null)) changes.push(f);
    });
    // Les notes et petits fichiers partent d'abord : un gros PDF ne retarde plus tout le reste.
    changes.sort((a, b) => a.taille - b.taille);
    let faits = 0;
    await enParallele(changes, PARALLELE, async (f) => {
      if (changes.length > 3) this.signaler('progression', ++faits, changes.length, 'envoi');
      const base = this.etat.bases[f.chemin] || null;
      const contenu = await this.fichiers.lire(f.chemin);
      if (!contenu) return; // supprimé pendant la lecture
      const h = await empreinte(contenu); // le fichier peut changer entre le premier hachage et l'envoi
      if (h === base) return;
      await this.envoyerBlob(h, contenu);
      if ((await this.valider(f.chemin, h, base)) === 409) { refus++; return; }
      this.etat.bases[f.chemin] = h;
      // Sauvegarde régulière : fermer Obsidian au milieu d'un gros envoi ne fait rien repartir de zéro.
      if (faits % 20 === 0) await this.sauver();
    });
    if (changes.length > 3) this.signaler('progression', 0, 0);
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

// Nombre d'envois ou de téléchargements simultanés : assez pour remplir la connexion, sans saturer le serveur.
const PARALLELE = 4;

/** Traite les éléments à `limite` à la fois ; la première erreur arrête les nouveaux départs puis remonte. */
async function enParallele(elements, limite, travail) {
  let i = 0, erreur = null;
  const ouvrier = async () => {
    while (!erreur && i < elements.length) {
      const e = elements[i++];
      try { await travail(e); } catch (err) { erreur ||= err; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, elements.length) }, ouvrier));
  if (erreur) throw erreur;
}

/* ---------- Intégration Obsidian ---------- */

// Doit rester égale à la version de manifest.json (un test le vérifie).
const VERSION = '0.4.16';
// Première version qui sait créer et supprimer des dossiers : en dessous, un ami voit les fichiers partir mais pas les dossiers.
const VERSION_DOSSIERS = '0.1.5';

function comparerVersions(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  return 0;
}

const PAR_DEFAUT = { serveur: '', coffreId: '', nomCoffre: '', jeton: '', prenom: '', derniereRev: 0, bases: {}, cache: {}, dossiers: {}, enAttente: {}, aVoir: {}, calendriers: [], cacheCalendriers: {}, dossiersIgnores: '', enPause: false, derniereSynchro: null, prevenirConnexions: true };

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
  const requete = O.requestUrl({ url, method: methode, headers: entetes, body: corps, contentType: type, throw: false }).then((r) => ({
    statut: r.status, json: async () => r.json, octets: async () => r.arrayBuffer,
  }));
  if (typeof setTimeout !== 'function') return requete;
  // 45 s, plus 1 s par 50 Ko envoyés : large pour un gros PDF, mais jamais infini
  // (sans limite, une requête perdue laissait « synchronisation… » affiché pour toujours).
  const delai = 45_000 + Math.ceil((corps?.byteLength || corps?.length || 0) / 50_000) * 1000;
  let minuteur;
  const limite = new Promise((_, refuser) => { minuteur = setTimeout(() => refuser(Object.assign(new Error('Le serveur ne répond pas. Nouvel essai bientôt.'), { reseau: true })), delai); });
  return Promise.race([requete, limite]).finally(() => clearTimeout(minuteur));
}

/** Notifications uniquement : les contenus continuent de passer par requestUrl. */
async function ecouterRevisions({ url, jeton, signal, recevoir, recevoirMessage = () => {}, ouvert = () => {}, requete = globalThis.fetch }) {
  const controleur = new AbortController();
  const arreter = () => controleur.abort();
  signal.addEventListener('abort', arreter, { once: true });
  let lecteur, minuteur;
  const surveiller = (ms) => { clearTimeout(minuteur); minuteur = setTimeout(arreter, ms); };
  try {
    if (signal.aborted) return;
    surveiller(10_000);
    const reponse = await requete(url, {
      headers: { Authorization: 'Bearer ' + jeton, Accept: 'text/event-stream' },
      signal: controleur.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
    });
    if (!reponse.ok || !reponse.headers.get('content-type')?.includes('text/event-stream') || !reponse.body?.getReader) throw Error('Flux indisponible');
    lecteur = reponse.body.getReader();
    ouvert();
    const decodeur = new TextDecoder();
    let tampon = '';
    for (;;) {
      surveiller(60_000); // le serveur envoie un battement toutes les 25 s
      const { value, done } = await lecteur.read();
      if (done || signal.aborted) break;
      tampon += decodeur.decode(value, { stream: true }).replace(/\r/g, '');
      if (tampon.length > 64 * 1024) throw Error('Notification trop grande');
      let fin;
      while ((fin = tampon.indexOf('\n\n')) !== -1) {
        const message = tampon.slice(0, fin); tampon = tampon.slice(fin + 2);
        const donnees = message.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        if (!donnees) continue;
        let rev, id;
        try { const evenement = JSON.parse(donnees); rev = evenement?.rev; id = evenement?.message; } catch { continue; }
        if (Number.isSafeInteger(rev) && rev >= 0 && !signal.aborted) recevoir(rev);
        if (Number.isSafeInteger(id) && id > 0 && !signal.aborted) recevoirMessage(id);
      }
    }
  } finally {
    clearTimeout(minuteur);
    signal.removeEventListener('abort', arreter);
    controleur.abort();
    await lecteur?.cancel().catch(() => {});
  }
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

let InvitationModal, ActiviteModal, RevisionModal, ProfilModal, FicheMembreModal, ReglagesCordee, PanneauCordee, VuePanneau, HistoriqueModal;
const VUE_CORDEE = 'cordee-panneau';
const VUE_SEMAINE = 'cordee-semaine';
let VueSemaine, EvenementModal, CreneauModal, dessinerSemaine;
const identifiantLocal = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

class CordeePlugin extends (O ? O.Plugin : Object) {
  async onload() {
    this.etat = Object.assign({}, PAR_DEFAUT, await this.loadData());
    this.ouverture = { avant: this.etat.derniereOuverture || this.etat.derniereSynchro || 0, le: Date.now(), coffreId: this.etat.coffreId };
    this.etat.derniereOuverture = this.ouverture.le;
    this.initialiserMoodle();
    if (this.connecte()) this.memoriserPreferences();
    this.phase = 'pret';
    this.derniereErreur = '';
    this.abonnesStatut = new Set();
    this.tableauxDiscussion = new Set();
    this.fichiersTropGros = new Set();
    this.fichiersBloques = new Map();
    this.dossiersEnAttente = new Set();
    this.etat.aVoir = this.nettoyerAVoir(this.etat.aVoir);
    this.etat.calendriers = [...(this.etat.calendriers || [])];
    this.etat.cacheCalendriers = { ...(this.etat.cacheCalendriers || {}) };
    this.abonnesCalendrier = new Set();
    this.barre = this.addStatusBarItem();
    // Les actions courantes restent accessibles depuis le statut, même panneau fermé.
    this.barre.addClass?.('mod-clickable');
    this.barre.onClickEvent?.((evt) => this.ouvrirMenuStatut(evt));
    this.presence = [];
    this.initialiserConnexions();
    enregistrerGeii(this);
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
    this.addCommand({ id: 'ouvrir', name: 'Ouvrir le panneau', callback: () => this.ouvrirPanneau() });
    this.addCommand({ id: 'discussion', name: 'Ouvrir la discussion', callback: () => this.ouvrirDiscussion() });
    this.addCommand({ id: 'historique', name: 'Historique de cette note', callback: () => { const f = this.app.workspace.getActiveFile?.(); if (f) new HistoriqueModal(this.app, this, f.path).open(); else new O.Notice('Ouvre d’abord une note.'); } });
    this.addCommand({ id: 'semaine', name: 'Ouvrir la semaine', callback: () => this.ouvrirSemaine() });
    this.addCommand({ id: 'cours-moodle', name: 'Cours Moodle', callback: () => new CoursMoodleModal(this.app, this).open() });
    this.addCommand({ id: 'notes-moodle', name: 'Mes notes Moodle', callback: () => new NotesMoodleModal(this.app, this).open() });
    this.addCommand({ id: 'creneau', name: 'Ajouter un créneau', callback: () => new CreneauModal(this.app, this).open() });
    this.addCommand({ id: 'presence', name: 'Montrer ou masquer ma présence', callback: () => this.basculerPresence() });
    this.addCommand({ id: 'prevenir-connexions', name: 'Prévenir quand un ami se connecte', callback: () => this.basculerNotificationsPresence() });
    this.addCommand({ id: 'synchroniser', name: 'Synchroniser maintenant', callback: () => this.lancer({ forcer: true }) });
    this.addCommand({ id: 'confirmer-suppressions', name: 'Confirmer les suppressions en attente', callback: () => this.confirmerSuppressions() });
    this.addCommand({ id: 'pause', name: 'Pause / reprise', callback: () => this.mettreEnPause(!this.etat.enPause) });
    this.addCommand({ id: 'inviter', name: 'Inviter un ami', callback: () => this.inviter() });
    this.addCommand({ id: 'activite', name: 'Voir qui a modifié quoi', callback: () => new ActiviteModal(this.app, this).open() });
    this.addCommand({ id: 'marquer-vu', name: 'Marquer cette note comme vue', callback: () => { const f = this.app.workspace.getActiveFile?.(); if (f) this.marquerVu(f.path); } });
    this.addCommand({ id: 'tout-vu', name: 'Tout marquer comme vu', callback: () => this.toutMarquerVu() });
    this.addCommand({ id: 'prochain-a-voir', name: 'Ouvrir la prochaine note à voir', callback: () => this.ouvrirProchainAVoir() });
    this.registerObsidianProtocolHandler('cordee', (params) => {
      const invitation = invitationValide(new URLSearchParams({ serveur: params.serveur || '', code: params.code || '' }));
      if (!invitation) { new O.Notice('Ce lien Cordée est incomplet. Demande une nouvelle invitation.'); return; }
      const panneau = new PanneauCordee(this.app, this);
      if (this.connecte()) new O.Notice('Ce coffre est déjà connecté. Ouvre un coffre vide pour rejoindre un autre groupe.');
      else panneau.reglages.form.invitation = 'obsidian://cordee?' + new URLSearchParams(invitation);
      panneau.open(); // Préremplit uniquement : rejoindre exige toujours une action de l'utilisateur.
    });

    this.app.workspace.onLayoutReady(() => {
      for (const ev of ['create', 'modify', 'delete', 'rename']) this.registerEvent(this.app.vault.on(ev, (f, ancien) => this.changementLocal(f, ancien)));
      // Les marques « à voir » suivent un fichier renommé et disparaissent avec un fichier supprimé.
      this.registerEvent(this.app.vault.on('rename', (f, ancien) => { if (this.etat.aVoir[ancien]) { this.etat.aVoir[f.path] = this.etat.aVoir[ancien]; delete this.etat.aVoir[ancien]; this.rafraichirMarques(); } }));
      this.registerEvent(this.app.vault.on('delete', (f) => { if (this.etat.aVoir[f?.path]) { delete this.etat.aVoir[f.path]; this.rafraichirMarques(); } }));
      // Ouvrir la note retire le point de l'explorateur ; les lignes restent surlignées jusqu'à « Vu ».
      this.registerEvent(this.app.workspace.on('file-open', (f) => { const e = f && this.etat.aVoir[f.path]; if (e && !e.ouvert) { e.ouvert = true; this.rafraichirMarques(); } }));
      this.registerEvent(this.app.workspace.on('file-open', (f) => this.annoncerPresence(f?.path ?? null)));
      this.registerEvent(this.app.workspace.on('file-menu', (menu, f) => {
        if (!this.connecte() || !(f instanceof O.TFolder) || !f.path) return;
        const ignore = this.etat.dossiersIgnores.split(',').map((s) => s.trim()).includes(f.path);
        menu.addItem((i) => i.setTitle(ignore ? 'Partager à nouveau ce dossier' : 'Ne pas partager ce dossier').setIcon(ignore ? 'folder-sync' : 'folder-lock').onClick(() => this.basculerPartageDossier(f.path)));
      }));
      this.registerEvent(this.app.workspace.on('file-menu', (menu, f) => {
        if (!this.connecte() || !(f instanceof O.TFile)) return;
        menu.addItem((i) => i.setTitle('Historique Cordée').setIcon('history').onClick(() => new HistoriqueModal(this.app, this, f.path).open()));
      }));
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
    this.arret = true; this.arreterFlux(); clearTimeout(this.minuteur); clearTimeout(this.minuteurMarques); this.abonnesStatut.clear(); this.styleMarques?.remove?.(); }

  /* ---------- Ce que les amis ont changé et que tu n'as pas encore vu ---------- */

  resumerAbsence() {
    const ouverture = this.ouverture;
    if (!ouverture || ouverture.resumee) return;
    ouverture.resumee = true;
    if (!ouverture.avant || ouverture.coffreId !== this.etat.coffreId) return;
    const comptes = new Map();
    for (const e of Object.values(this.etat.aVoir || {})) {
      // Les changements arrivés pendant cette session ne font pas partie de l'absence.
      if (!(e.le > ouverture.avant && e.le <= ouverture.le)) continue;
      for (const auteur of new Set(e.auteurs || [])) {
        if (!auteur || auteur === this.etat.prenom) continue;
        comptes.set(auteur, (comptes.get(auteur) || 0) + 1);
      }
    }
    if (comptes.size) new O.Notice('Pendant ton absence : ' + [...comptes].map(([nom, n], i) => `${nom}${i ? '' : ' a modifié'} ${n}${i ? '' : ` note${n > 1 ? 's' : ''}`}`).join(', ') + '.', 7000);
  }

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

  async ouvrirDiscussion() {
    await this.ouvrirPanneau();
    for (const tableau of this.tableauxDiscussion) {
      if (!tableau.actif()) continue;
      tableau.discussion.corps.parentElement.open = true;
      tableau.discussion.corps.scrollIntoView?.({ block: 'nearest' });
      tableau.saisieDiscussion.focus?.();
    }
  }

  discussionCourante() {
    const cle = JSON.stringify([this.etat.serveur, this.etat.coffreId, this.etat.jeton]);
    // Le contenu reste en mémoire et ne traverse jamais un changement de coffre ou de compte.
    if (this.discussion?.cle !== cle) this.discussion = { cle, messages: [], dernier: 0, chargee: false, cible: 0 };
    return this.discussion;
  }

  afficherDiscussion() {
    for (const tableau of this.tableauxDiscussion) if (tableau.actif()) tableau.afficherDiscussion();
  }

  rafraichirDiscussion(cible = 0) {
    if (this.arret || !this.connecte()) return Promise.resolve();
    const discussion = this.discussionCourante();
    discussion.cible = Math.max(discussion.cible, cible);
    if (discussion.ancienne) return Promise.resolve();
    if (discussion.chargement) return discussion.chargement;
    const coffreId = this.etat.coffreId;
    const courant = () => !this.arret && this.discussionCourante() === discussion;
    discussion.chargement = (async () => {
      try {
        let suite;
        do {
          const cibleAvant = discussion.cible;
          const depuis = discussion.chargee ? discussion.dernier : null;
          const info = await (await this.moteur.api('GET', `/api/coffres/${coffreId}/messages?limite=50${depuis === null ? '' : '&depuis=' + depuis}`)).json();
          if (!courant()) return;
          if (!Array.isArray(info.messages)) { const erreur = new Error('Ancien serveur'); erreur.statut = 404; throw erreur; }
          discussion.moiId = info.moiId;
          const nouveaux = info.messages.filter((m) => Number.isSafeInteger(m.id) && m.id > discussion.dernier && typeof m.texte === 'string');
          const prevenir = discussion.chargee;
          discussion.messages = [...discussion.messages, ...nouveaux].slice(-50);
          if (nouveaux.length) discussion.dernier = nouveaux[nouveaux.length - 1].id;
          discussion.chargee = true; discussion.erreur = '';
          const visible = [...this.tableauxDiscussion].some((t) => t.discussionVisible());
          if (prevenir && !visible) for (const message of nouveaux) {
            if (message.auteurId !== discussion.moiId) {
              const debut = message.texte.replace(/\s+/g, ' ').slice(0, 80);
              new O.Notice(`${message.auteur || 'Membre'} : ${debut}${message.texte.length > 80 ? '…' : ''}`, 5000);
            }
          }
          this.afficherDiscussion();
          // Un événement reçu pendant la lecture relance le rattrapage sans requête concurrente.
          suite = (nouveaux.length && depuis !== null && info.plus)
            || (discussion.dernier < discussion.cible && (nouveaux.length || cibleAvant < discussion.cible));
        } while (suite && courant());
      } catch (erreur) {
        if (!courant()) return;
        if (erreur.statut === 404) discussion.ancienne = true;
        else discussion.erreur = expliquerErreur(erreur);
        this.afficherDiscussion();
      }
    })().finally(() => { discussion.chargement = null; });
    return discussion.chargement;
  }

  /* ---------- Présence : qui a quelle note ouverte ---------- */

  majPresence(liste) {
    const propre = liste.filter((p) => p && typeof p.nom === 'string').map((p) => ({ id: p.id, nom: p.nom, chemin: typeof p.chemin === 'string' ? p.chemin : null }));
    const dejaConnue = this.presenceConnue !== null && this.coffrePresence === `${this.etat.serveur}/${this.etat.coffreId}`;
    this.prevenirConnexions(propre);
    if (JSON.stringify(propre) === JSON.stringify(this.presence)) return;
    const actif = this.app.workspace.getActiveFile?.()?.path;
    const avant = new Set(this.presence.filter((p) => p.chemin === actif).map((p) => p.id));
    const arrives = propre.filter((p) => actif && p.chemin === actif && !avant.has(p.id) && this.presence.some((a) => a.id === p.id));
    if (dejaConnue && arrives.length) new O.Notice(`Cordée : ${arrives.map((p) => p.nom).join(', ')} ${arrives.length > 1 ? 'sont' : 'est'} aussi sur cette note.`, 5000);
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
    const corps = this.etat.presenceMasquee ? { parti: true, masquee: true } : this.etat.enPause ? { parti: true } : { chemin: partage };
    try {
      const r = await (await this.moteur.api('POST', `/api/coffres/${this.etat.coffreId}/presence`, corps)).json();
      if (Array.isArray(r.presence)) this.majPresence(r.presence);
    } catch (e) { if (e?.statut === 404) this.presenceIndisponible = true; } // ancien serveur : sans présence, rien ne change
  }

  async basculerPresence() {
    this.etat.presenceMasquee = !this.etat.presenceMasquee;
    try { await this.saveData(this.etat); } catch { /* simple préférence */ }
    await this.annoncerPresence(this.app.workspace.getActiveFile?.()?.path ?? null);
    new O.Notice(this.etat.presenceMasquee ? 'Cordée : ta présence et ta dernière activité sont masquées.' : 'Cordée : ta présence et ta dernière activité sont à nouveau visibles.');
  }

  presenceSur(chemin) { return this.presence.filter((p) => p.chemin === chemin); }

  /* ---------- Arrivée des amis : discrète et sans répétition ---------- */

  initialiserConnexions() {
    this.presenceConnue = null;
    this.coffrePresence = `${this.etat.serveur}/${this.etat.coffreId}`;
    this.etat.alertesConnexions = Object.fromEntries(Object.entries(this.etat.alertesConnexions || {}).filter(([, t]) => Number.isFinite(t) && Date.now() - t < 30 * 60_000));
  }

  prevenirConnexions(liste) {
    const coffre = `${this.etat.serveur}/${this.etat.coffreId}`;
    if (coffre !== this.coffrePresence) this.initialiserConnexions();
    const t = Date.now();
    const arrivees = arriveesPresence(this.presenceConnue, liste, this.etat.alertesConnexions, t, this.etat.prevenirConnexions, coffre);
    // Le premier résultat réussi sert de point de départ, même s'il est vide.
    this.presenceConnue = liste;
    for (const ami of arrivees) {
      this.etat.alertesConnexions[`${coffre}:${ami.id}`] = t;
      new O.Notice(`${ami.nom} vient de se connecter`, 5000);
    }
    if (arrivees.length) this.saveData(this.etat).catch(() => {});
  }

  async basculerNotificationsPresence() {
    const avant = this.etat.prevenirConnexions;
    this.etat.prevenirConnexions = !avant;
    try { await this.saveData(this.etat); }
    catch { this.etat.prevenirConnexions = avant; new O.Notice('Impossible de conserver ce réglage. Vérifie que le coffre est accessible en écriture.'); return; }
    new O.Notice(this.etat.prevenirConnexions ? 'Cordée : tu seras prévenu quand un ami se connecte.' : 'Cordée : les notifications de connexion sont désactivées.');
  }

  /** Remet une ancienne version d'un fichier ; elle part chez les autres à la synchro suivante. */
  async restaurer(chemin, hash) {
    const contenu = await this.moteur.telecharger(hash);
    await this.moteur.fichiers.ecrire(chemin, contenu);
    if (this.etat.aVoir[chemin]) delete this.etat.aVoir[chemin];
    this.rafraichirMarques(0);
    this.programmer(200);
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
      for (const s of this.toutesSources(await this.texteAgenda())) {
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
    const texte = await this.texteAgenda();
    for (const s of this.toutesSources(texte)) {
      const cache = this.etat.cacheCalendriers[s.id];
      for (const e of developper(cache?.evenements || [], de, a)) tous.push({ ...e, source: s.nom, type: s.type, partage: !!s.partage, couleur: COULEURS_CALENDRIER[s.type] || COULEURS_CALENDRIER.autre });
    }
    for (const e of lireAgendaPartage(texte)) if (e.fin > de && e.debut < a) tous.push({ ...e, source: 'Agenda de la cordée', type: 'cordee', couleur: COULEURS_CALENDRIER.cordee });
    // Devoirs lus par la connexion Moodle : ils savent s'ils sont rendus. Le même devoir venu aussi
    // du lien iCal Moodle (même heure limite) n'est montré qu'une fois, avec son état.
    for (const d of (typeof this.devoirsMoodle === 'function' ? this.devoirsMoodle() : [])) {
      if (!(d.debut >= de && d.debut < a)) continue;
      const doublon = tous.findIndex((e) => e.type === 'moodle' && Math.abs(e.debut - d.debut) < 60_000);
      if (doublon >= 0) tous.splice(doublon, 1);
      tous.push({ titre: d.titre, debut: d.debut, fin: d.debut, type: 'moodle', source: d.cours ? `Moodle · ${d.cours}` : 'Moodle', rendu: !!d.rendu, url: d.url, couleur: COULEURS_CALENDRIER.moodle });
    }
    return tous.sort((x, y) => x.debut - y.debut);
  }

  /** Texte de la note « Agenda de la cordée » (vide si elle n'existe pas encore ou s'écrit en ce moment). */
  async texteAgenda() {
    const note = this.app.vault.getAbstractFileByPath?.(NOTE_AGENDA);
    if (!note || (O.TFile && !(note instanceof O.TFile))) return '';
    try { return await this.app.vault.cachedRead(note); } catch { return ''; }
  }

  /**
   * Calendriers de cet appareil + calendriers partagés de la cordée. Un même lien présent des deux côtés
   * n'est compté qu'une fois (version partagée). Un lien Moodle partagé par erreur est ignoré : il est personnel.
   */
  toutesSources(texteAgenda) {
    const partages = lireCalendriersPartages(texteAgenda).filter((s) => s.type !== 'moodle');
    const urls = new Set(partages.map((s) => s.url));
    return [...this.etat.calendriers.filter((s) => !urls.has(s.url)), ...partages];
  }

  /** Ajoute un emploi du temps pour toute la cordée : le lien va dans la note partagée, chacun le lit. */
  async ajouterCalendrierPourTous(nom, url) {
    const lien = String(url || '').trim();
    if (!/^(https?|webcal):\/\/\S+$/i.test(lien)) throw new Error('Colle un lien iCal complet, qui commence par https:// ou webcal://');
    if (typeCalendrier(lien) === 'moodle') throw new Error('Un lien Moodle est personnel : il ouvre ton compte. Ajoute-le « pour moi » seulement ; chacun ajoute le sien.');
    const source = { nom: String(nom || '').trim() || ({ edt: 'Emploi du temps' }[typeCalendrier(lien)] || 'Calendrier'), url: lien };
    const vault = this.app.vault;
    const note = vault.getAbstractFileByPath(NOTE_AGENDA);
    if (note) await vault.process(note, (t) => modifierCalendriersPartages(t, { ajouter: source }));
    else await vault.create(NOTE_AGENDA, modifierCalendriersPartages(`# Agenda de la cordée\n\nUne ligne par créneau, visible par toute la cordée dans la vue Semaine de Cordée.\nFormat : - AAAA-MM-JJ HH:MM-HH:MM Titre @ Lieu\n`, { ajouter: source }));
    // Si ce lien était déjà ajouté « pour moi », la version partagée le remplace.
    this.etat.calendriers = this.etat.calendriers.filter((s) => s.url !== lien);
    const partage = lireCalendriersPartages(await this.texteAgenda()).find((s) => s.url === lien) || { id: 'p' + empreinteCourte(lien) };
    await this.actualiserCalendriers({ forcer: true, seulement: partage.id });
    return { ...source, id: partage.id, type: typeCalendrier(lien), partage: true };
  }

  async retirerCalendrierPartage(url) {
    const note = this.app.vault.getAbstractFileByPath(NOTE_AGENDA);
    if (note) await this.app.vault.process(note, (t) => modifierCalendriersPartages(t, { retirerUrl: url }));
    delete this.etat.cacheCalendriers['p' + empreinteCourte(url)];
    try { await this.saveData(this.etat); } catch { /* cache seulement */ }
    this.rafraichirCalendrier();
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
  /** La modification la plus récente d'abord : on suit le fil sans passer par le panneau. */
  async ouvrirProchainAVoir() {
    const [suivant] = Object.entries(this.etat.aVoir || {}).sort((a, b) => (b[1]?.le || 0) - (a[1]?.le || 0));
    if (!suivant) { new O.Notice('Cordée : rien à voir.'); return; }
    try { await this.ouvrirModif(suivant[0]); } catch { new O.Notice(`Impossible d’ouvrir ${suivant[0]}.`); }
  }

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
      ignorer: (p) => dansConfiguration(p, this.app.vault.configDir) || (!this.etat.partagerVideos && estVideo(p)) || this.etat.dossiersIgnores.split(',').map((s) => s.trim()).filter(Boolean).some((d) => dansDossier(p, d)),
      signaler: (quoi, a, b, c) => {
        if (quoi === 'synchro') { this.phase = 'synchro'; this.derniereErreur = ''; this.sourceErreur = ''; this.fichiersTropGros.clear(); this.fichiersBloques.clear(); this.dossiersEnAttente.clear(); this.suppressionsBloquees = 0; }
        else if (quoi === 'ok') this.phase = 'ok';
        else if (quoi === 'encore') { this.phase = 'ok'; this.programmer(2000); }
        else if (quoi === 'progression') { this.progression = b ? `${c === 'envoi' ? 'envoi' : 'réception'} ${a}/${b}` : ''; }
        else if (quoi === 'erreur') { this.signalerErreur(a, 'synchro'); if (a?.reseau || a?.statut >= 500) this.programmer(15_000); } // réseau coupé : nouvel essai seul dans 15 s
        else if (quoi === 'conflit') new O.Notice(`Cordée : ${a} modifié aussi par ${b || 'un ami'}. Les deux versions sont gardées, vérifie la note.`, 10000);
        else if (quoi === 'garde-fou') this.annoncerGardeFou(a, b);
        else if (quoi === 'dossiers-indisponibles') new O.Notice('Cordée : serveur à mettre à jour pour les dossiers vides. Les notes se synchronisent.', 10000);
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
    if (this.phase === 'synchro') return this.etat.enPause ? 'fin de la synchronisation en cours…' : `synchronisation…${this.progression ? ' ' + this.progression : ''}`;
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
  /** Place du serveur (gardée 1 min) ; null si le serveur est trop ancien pour la donner. */
  async lireStockage() {
    if (this.stockage && Date.now() - this.stockage.le < 60_000) return this.stockage;
    // Une seule lecture à la fois, même si le panneau la demande plusieurs fois de suite.
    this.lectureStockage ||= (async () => {
      try {
        const r = await this.moteur.api('GET', `/api/coffres/${this.etat.coffreId}/stockage`);
        this.stockage = { ...(await r.json()), le: Date.now() };
      } catch { this.stockage = null; }
      finally { this.lectureStockage = null; }
      return this.stockage;
    })();
    return this.lectureStockage;
  }

  async verifierVersions() {
    if (!this.connecte() || this.arret) return;
    const t = Date.now();
    if (this.derniereVerifVersions && t - this.derniereVerifVersions < 30 * 60_000) return;
    this.derniereVerifVersions = t;
    try {
      const info = await (await this.moteur.api('GET', `/api/coffres/${this.etat.coffreId}`)).json();
      const retard = (info.membres || []).filter((m) => m.id !== info.moiId && (!m.version || comparerVersions(m.version, VERSION_DOSSIERS) < 0)).map((m) => m.nom);
      const cle = retard.join('|');
      if (retard.length && cle !== this.dernierRetardVersions) new O.Notice(`Cordée : ${retard.join(', ')} doit mettre à jour l’extension (les dossiers ne se synchronisent pas chez lui).`, 20000);
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
    afficherBarrePresence(this.barre, `Cordée : ${this.titreStatut()}${aVoir ? ` · ${aVoir} à voir` : ''}`, enLigne);
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
    this.echeanceSynchro = undefined;
    this.moteur.encore = false;
    try { await this.saveData(this.etat); }
    catch {
      this.etat.enPause = avant;
      new O.Notice('Impossible de conserver ce réglage. Vérifie que le coffre est accessible en écriture.');
      this.afficher();
      return;
    }
    if (enPause) this.arreterFlux();
    else { this.prochainFlux = 0; this.maintenirFlux(); }
    this.afficher();
    if (!enPause) await this.lancer();
  }

  ouvrirMenuStatut(evt) {
    if (!O.Menu) return this.ouvrirPanneau();
    const menu = new O.Menu();
    menu.addItem((i) => i.setTitle('Synchroniser').setIcon('refresh-cw').onClick(() => this.lancer({ forcer: true })));
    menu.addItem((i) => i.setTitle(this.etat.enPause ? 'Reprendre' : 'Pause').setIcon(this.etat.enPause ? 'play' : 'pause').onClick(() => this.mettreEnPause(!this.etat.enPause)));
    menu.addItem((i) => i.setTitle('Ouvrir le panneau').setIcon('panel-right').onClick(() => this.ouvrirPanneau()));
    menu.addItem((i) => i.setTitle('Ouvrir la semaine').setIcon('calendar-days').onClick(() => this.ouvrirSemaine()));
    menu.addItem((i) => i.setTitle('Ouvrir la prochaine note à voir').setIcon('arrow-right').onClick(() => this.ouvrirProchainAVoir()));
    if (evt?.clientX !== undefined) menu.showAtMouseEvent(evt);
    else { const r = this.barre.getBoundingClientRect(); menu.showAtPosition({ x: r.left, y: r.top }); }
  }

  async basculerPartageDossier(chemin) {
    if (!this.connecte() || !chemin) return;
    // Le format existant utilise la virgule comme séparateur : ce nom serait ambigu.
    if (chemin.includes(',')) { new O.Notice('Ce nom de dossier contient une virgule.'); return; }
    const avant = this.etat.dossiersIgnores;
    const dossiers = new Set(avant.split(',').map((s) => s.trim()).filter(Boolean));
    const partager = dossiers.delete(chemin);
    if (!partager) dossiers.add(chemin);
    this.etat.dossiersIgnores = [...dossiers].join(', ');
    try { await this.saveData(this.etat); }
    catch { this.etat.dossiersIgnores = avant; new O.Notice('Impossible de conserver ce réglage.'); return; }
    new O.Notice(partager ? 'Ce dossier est à nouveau partagé.' : 'Ce dossier n’est plus partagé.');
    await this.lancer({ forcer: true });
  }

  changementLocal(f, ancien) {
    const chemins = [f?.path, typeof ancien === 'string' ? ancien : null].filter((p) => p && !this.moteur.ignorer(p));
    if (!chemins.length) return;
    for (const p of chemins) {
      this.moteur.fichiers.invaliderDossier(p);
      delete this.etat.cache[p]; // même taille et mtime arrondi : le contenu peut tout de même avoir changé
    }
    this.programmer(200);
  }

  programmer(ms) {
    if (!this.connecte() || this.etat.enPause || this.arret) return;
    const echeance = Date.now() + ms;
    if (this.echeanceSynchro !== undefined && this.echeanceSynchro <= echeance) return;
    clearTimeout(this.minuteur);
    this.echeanceSynchro = echeance;
    // Une frappe continue ne repousse jamais l'envoi du premier changement.
    this.minuteur = setTimeout(() => { this.echeanceSynchro = undefined; this.minuteur = null; return this.lancer(); }, ms);
  }

  async lancer({ forcer = false } = {}) {
    if (!this.connecte() || this.arret || (this.etat.enPause && !forcer)) return;
    await this.moteur.synchroniser();
    const resume = this.texteBloques();
    if (resume && resume !== this.dernierResumeBloques) new O.Notice('Cordée : ' + resume, 15000);
    this.dernierResumeBloques = resume;
    if (this.phase === 'ok') this.verifierVersions();
    if (this.phase === 'ok') {
      this.resumerAbsence();
      this.etat.derniereSynchro = Date.now();
      try { await this.saveData(this.etat); }
      catch { this.derniereErreur = 'Impossible de conserver l’état local. Vérifie que le dossier du coffre est accessible en écriture.'; }
      this.afficher();
    }
  }

  arreterFlux() {
    const flux = this.fluxRevisions;
    this.fluxRevisions = null;
    flux?.controleur.abort();
  }

  maintenirFlux() {
    if (this.arret || !this.connecte() || this.etat.enPause) { this.arreterFlux(); return; }
    const cle = JSON.stringify([this.etat.serveur, this.etat.coffreId, this.etat.jeton]);
    if (this.fluxRevisions?.cle === cle) return;
    if (this.fluxRevisions) this.arreterFlux();
    if (typeof globalThis.fetch !== 'function' || typeof globalThis.AbortController !== 'function' || Date.now() < (this.prochainFlux || 0)) return;
    const flux = { cle, controleur: new AbortController(), connecte: false };
    this.fluxRevisions = flux;
    flux.termine = ecouterRevisions({
      url: this.moteur.url(this.moteur.racine() + '/evenements'), jeton: this.etat.jeton, signal: flux.controleur.signal,
      ouvert: () => { if (this.fluxRevisions === flux) { flux.connecte = true; this.rafraichirDiscussion(); } },
      recevoir: (rev) => { if (this.fluxRevisions === flux && rev > this.etat.derniereRev) this.programmer(0); },
      recevoirMessage: (id) => { if (this.fluxRevisions === flux) this.rafraichirDiscussion(id); },
    }).catch(() => { /* requestUrl prend le relais si le flux est bloqué sur cet appareil. */ }).finally(() => {
      if (this.fluxRevisions !== flux) return;
      this.fluxRevisions = null;
      this.prochainFlux = Date.now() + 10_000;
    });
  }

  // Secours sans flux fetch/CORS, et actualisation de la présence, y compris sur mobile.
  ecouter() {
    this.maintenirFlux();
    this.registerInterval(window.setInterval(async () => {
      this.maintenirFlux();
      if (this.arret || !this.connecte() || this.etat.enPause || this.ecouteEnCours) return;
      if (this.fluxRevisions?.connecte && Date.now() - (this.dernierSondage || 0) < 15_000) return;
      this.dernierSondage = Date.now();
      this.ecouteEnCours = true;
      const acces = [this.etat.serveur, this.etat.coffreId, this.etat.jeton];
      const courant = () => !this.arret && this.connecte() && !this.etat.enPause && acces.every((v, i) => v === [this.etat.serveur, this.etat.coffreId, this.etat.jeton][i]);
      try {
        const info = await (await this.moteur.api('GET', `/api/coffres/${this.etat.coffreId}?revision=1`)).json();
        if (!courant()) return;
        if (Array.isArray(info.presence)) this.majPresence(info.presence);
        if (!this.arret && this.connecte() && !this.etat.enPause && info.rev > this.etat.derniereRev) await this.lancer();
        else if (!this.arret && this.connecte() && !this.etat.enPause && !this.moteur.enCours) {
          if (this.sourceErreur === 'sondage') { this.derniereErreur = ''; this.phase = 'pret'; }
          this.afficher();
        }
        if (courant()) await this.rafraichirDiscussion();
      } catch (erreur) { if (courant() && this.sourceErreur !== 'synchro') this.signalerErreur(erreur, 'sondage'); }
      finally { this.ecouteEnCours = false; }
    }, 2500));
  }

  async rejoindreOuCreer(chemin, corps, serveur) {
    const r = await httpObsidian({ methode: 'POST', url: serveur.replace(/\/$/, '') + chemin, corps: JSON.stringify(corps), type: 'application/json' });
    const j = await r.json();
    if (r.statut >= 400) throw new Error((j && j.erreur) || `Erreur ${r.statut}`);
    Object.assign(this.etat, { serveur: serveur.replace(/\/$/, ''), coffreId: j.coffreId, nomCoffre: j.nom, jeton: j.jeton, prenom: corps.prenom, derniereRev: 0, bases: {}, cache: {}, dossiers: Object.create(null), enPause: false, derniereSynchro: null });
    await this.saveData(this.etat);
    this.prochainFlux = 0;
    this.maintenirFlux();
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
    this.arreterFlux();
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

/* ---------- Présence des amis : dates, résumé et pastilles ---------- */

function arriveesPresence(avant, apres, dernieres, maintenant, actif = true, coffre = '') {
  if (avant === null || !actif) return [];
  const connus = new Set(avant.map((p) => p.id));
  const retenus = new Set();
  return apres.filter((p) => {
    if (!p.id || connus.has(p.id) || retenus.has(p.id)) return false;
    retenus.add(p.id);
    const derniere = dernieres[`${coffre}:${p.id}`];
    return !Number.isFinite(derniere) || maintenant - derniere >= 30 * 60_000;
  });
}

function derniereActivite(vuLe, maintenant = Date.now()) {
  if (!Number.isFinite(vuLe) || vuLe <= 0) return 'pas encore connecté';
  const aujourdHui = new Date(maintenant); aujourdHui.setHours(0, 0, 0, 0);
  const hier = new Date(aujourdHui); hier.setDate(hier.getDate() - 1);
  if (vuLe >= hier.getTime() && vuLe < aujourdHui.getTime()) return 'vu hier';
  return `vu ${ilYa(vuLe, maintenant)}`;
}

function resumePresence(membres, presence, moiId, maintenant = Date.now()) {
  const amis = membres.filter((m) => m.id !== moiId);
  const ids = new Set(amis.map((m) => m.id));
  const enLigne = presence.filter((p) => ids.has(p.id));
  if (enLigne.length) return `${enLigne.slice(0, 2).map((p) => p.nom).join(', ')}${enLigne.length > 2 ? '…' : ''} ${enLigne.length > 1 ? 'sont' : 'est'} en ligne`;
  const dernier = amis.slice().sort((a, b) => (b.vu_le || 0) - (a.vu_le || 0))[0];
  return `Personne d’autre en ligne${dernier ? ` · ${dernier.nom} ${derniereActivite(dernier.vu_le, maintenant)}` : ''}`;
}

function afficherBarrePresence(barre, texte, noms) {
  const suite = noms.length ? `${noms.slice(0, 2).join(', ')}${noms.length > 2 ? '…' : ''} en ligne` : '';
  if (!barre.createEl) { barre.setText(texte + (suite ? ` · ${suite}` : '')); return; }
  barre.addClass?.('cordee-barre');
  barre.setAttribute?.('title', texte + (suite ? ` · ${suite}` : ''));
  barre.setText(texte);
  if (suite) {
    barre.createEl('span', { text: ' · ' });
    barre.createEl('span', { text: suite, cls: 'cordee-presence-barre' });
  }
}

function octetsLisibles(n) {
  const unites = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0, v = Math.max(0, Number(n) || 0);
  while (v >= 1024 && i < unites.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1).replace('.', ',')} ${unites[i]}`;
}

function texteSiChange(el, texte) { if (el.textContent !== texte) el.setText(texte); }
function attributSiChange(el, nom, valeur) { if (el.getAttribute(nom) !== valeur) el.setAttribute(nom, valeur); }

// Conserver les lignes inchangées évite de perdre le focus et de faire s'effondrer le panneau.
function reconcilierListe(zone, elements) {
  const gardes = new Set(elements);
  for (const enfant of [...zone.children]) if (!gardes.has(enfant)) enfant.remove();
  elements.forEach((el, i) => { if (zone.children[i] !== el) zone.insertBefore(el, zone.children[i] || null); });
}

function rafraichirPresenceTableau(tableau) {
  const presence = tableau.plugin.presence || [];
  for (const { statut, membre } of tableau.lignesPresence || []) {
    const ici = presence.find((p) => p.id === membre.id);
    attributSiChange(statut, 'data-en-ligne', String(!!ici));
    texteSiChange(statut, ici ? `en ligne${ici.chemin ? ` · sur ${nomFichier(ici.chemin)}` : ''}` : derniereActivite(membre.vu_le));
  }
  if (tableau.resumePresence) texteSiChange(tableau.resumePresence, resumePresence(tableau.membresPresence || [], presence, tableau.moiPresence));
}

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
 * - 2026-11-12 14:00-16:00 Révision ENER3 @ BU (ajouté par Bruno)
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

/**
 * Calendriers partagés : des liens Markdown dans la note « Agenda de la cordée », sous
 * « ## Calendriers partagés ». Chaque membre les lit : un emploi du temps commun s'ajoute une fois pour tous.
 * - [Emploi du temps GEII S3](https://ade.exemple.fr/…)
 */
const TITRE_PARTAGES = '## Calendriers partagés';
function lireCalendriersPartages(texte) {
  const sources = [];
  const vus = new Set();
  for (const ligne of String(texte || '').split(/\r?\n/)) {
    const m = /^\s*[-*]\s+\[([^\]]{1,60})\]\(((?:https?|webcal):\/\/[^)\s]+)\)\s*$/i.exec(ligne);
    if (!m || vus.has(m[2])) continue;
    vus.add(m[2]);
    sources.push({ id: 'p' + empreinteCourte(m[2]), nom: m[1].trim(), url: m[2], type: typeCalendrier(m[2]), partage: true });
  }
  return sources;
}

/** Ajoute (ou retire) un lien dans la section des calendriers partagés, en laissant le reste de la note intact. */
function modifierCalendriersPartages(texte, { ajouter, retirerUrl }) {
  let lignes = String(texte || '').replace(/\r\n/g, '\n').split('\n');
  if (retirerUrl) lignes = lignes.filter((l) => !(l.includes(`](${retirerUrl})`) && /^\s*[-*]\s+\[/.test(l)));
  if (ajouter) {
    const ligne = `- [${String(ajouter.nom).replace(/[[\]\r\n]/g, ' ').trim().slice(0, 60) || 'Calendrier'}](${ajouter.url})`;
    const i = lignes.findIndex((l) => l.trim() === TITRE_PARTAGES);
    if (i >= 0) lignes.splice(i + 1, 0, ligne);
    else {
      // Juste après le titre de la note (et son paragraphe d'explication), avant les créneaux.
      const premierCreneau = lignes.findIndex((l) => /^\s*[-*]\s+(?:\[[ xX]\]\s+)?\d{4}-\d{2}-\d{2}/.test(l));
      const ou = premierCreneau >= 0 ? premierCreneau : lignes.length;
      lignes.splice(ou, 0, TITRE_PARTAGES, 'Liens iCal visibles par toute la cordée (emploi du temps commun…). Jamais de lien Moodle : il est personnel.', ligne, '', '## Créneaux');
      if (premierCreneau < 0) lignes.push('');
    }
  }
  return lignes.join('\n');
}

function empreinteCourte(texte) {
  let h = 5381;
  for (const car of String(texte)) h = ((h * 33) ^ car.codePointAt(0)) >>> 0;
  return h.toString(36);
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

function afficherIconeBouton(bouton, nom, texte) {
  // Le catalogue d'icônes dépend de la version d'Obsidian : une icône inconnue ne doit jamais laisser une action vide.
  bouton.empty();
  try { O?.setIcon?.(bouton, nom); } catch { /* Le libellé reste utilisable si le thème ou l'API refuse l'icône. */ }
  const svg = bouton.querySelector?.('svg');
  if (svg) {
    // La classe native évite les marges intérieures des boutons texte d'Obsidian, qui compriment le SVG.
    bouton.addClass('clickable-icon', 'cordee-bouton-icone');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  } else {
    bouton.removeClass?.('clickable-icon', 'cordee-bouton-icone');
    bouton.setText(texte);
  }
}

function boutonCordee(c, texte, action, options = {}) {
  const bouton = c.createEl('button', { text: texte, cls: 'cordee-bouton ' + (options.cls || ''), attr: { type: 'button', 'aria-label': options.label || texte, title: options.label || texte, ...options.attr } });
  if (options.icone) afficherIconeBouton(bouton, options.icone, texte);
  bouton.onclick = (evt) => { if (!bouton.disabled) return action(evt); };
  return bouton;
}

// Sections du panneau repliables comme une FAQ ; l'état replié est retenu sur cet appareil.
const CLE_SECTIONS = 'cordee.sections-fermees';
function sectionsFermees() { try { return new Set(JSON.parse(globalThis.localStorage?.getItem(CLE_SECTIONS) || '[]')); } catch { return new Set(); } }
function accordeon(parent, cle, titre) {
  const d = parent.createEl('details', { cls: 'cordee-accordeon' });
  d.open = !sectionsFermees().has(cle);
  const entete = d.createEl('summary', { cls: 'cordee-section-titre' });
  const h = entete.createEl('h3', { text: titre });
  const actions = entete.createEl('span', { cls: 'cordee-section-actions' });
  // Un clic sur un bouton de l'en-tête fait son action sans replier la section.
  entete.addEventListener?.('click', (e) => { if (e.target?.closest?.('button')) e.preventDefault(); });
  d.addEventListener?.('toggle', () => {
    const fermees = sectionsFermees();
    if (d.open) fermees.delete(cle); else fermees.add(cle);
    try { globalThis.localStorage?.setItem(CLE_SECTIONS, JSON.stringify([...fermees])); } catch { /* préférence facultative */ }
  });
  return { titre: h, actions, corps: d.createEl('div', { cls: 'cordee-accordeon-corps' }) };
}

// Un cadre dédié garde les formulaires lisibles sans modifier le panneau d’activité.
function preparerPageSecondaire(modal) {
  modal.contentEl.addClass?.('cordee-page');
  modal.modalEl?.classList?.add('cordee-page-modal');
}

if (O) {
  InvitationModal = class extends O.Modal {
    constructor(app, lien) { super(app); this.lien = lien; }
    onOpen() {
      preparerPageSecondaire(this);
      const { contentEl: c } = this;
      c.createEl('h3', { text: 'Invitation prête' });
      c.createEl('p', { text: 'Partage ce lien, valable 7 jours pour 5 personnes maximum.' });
      const champ = c.createEl('input', { type: 'text', value: this.lien, cls: 'cordee-lien-invitation', attr: { 'aria-label': 'Lien d’invitation' } }); champ.readOnly = true;
      new O.Setting(c).addButton((b) => b.setButtonText('Copier').setCta().onClick(async () => {
        try { await navigator.clipboard.writeText(this.lien); new O.Notice('Lien copié'); } catch (e) { champ.select(); }
      }));
    }
    onClose() { this.contentEl.empty(); }
  };

  /** Fiche d'un membre : photo, présence, activité récente et raccourcis. */
  FicheMembreModal = class extends O.Modal {
    constructor(app, plugin, membre, infos) { super(app); this.plugin = plugin; this.membre = membre; this.infos = infos; }
    onOpen() {
      preparerPageSecondaire(this);
      const c = this.contentEl, m = this.membre, i = this.infos;
      c.empty(); this.modalEl?.classList.add('cordee-fiche-modal');
      const tete = c.createEl('div', { cls: 'cordee-fiche-tete' });
      afficherAvatar(tete, m.nom, m.avatar);
      const id = tete.createEl('div');
      id.createEl('h2', { text: m.nom + (i.moi ? ' (toi)' : ''), cls: 'cordee-titre' });
      if (i.statut) id.createEl('p', { text: i.statut, cls: 'cordee-presence-membre' });
      if (i.compte) c.createEl('p', { text: i.compte, cls: 'cordee-details' });
      const actions = c.createEl('div', { cls: 'cordee-commandes' });
      boutonCordee(actions, 'Voir ses changements', () => { this.close(); return i.filtrer(); }, { cls: 'cordee-bouton-principal' });
      if (i.moi) boutonCordee(actions, 'Modifier mon profil', () => { this.close(); new ProfilModal(this.app, this.plugin).open(); }, { cls: 'cordee-bouton-discret' });
    }
    onClose() { this.contentEl.empty(); }
  };

  ProfilModal = class extends O.Modal {
    constructor(app, plugin) { super(app); this.plugin = plugin; }
    async onOpen() {
      preparerPageSecondaire(this);
      const { contentEl: c } = this;
      this.ferme = false;
      const tour = this.tour = (this.tour || 0) + 1;
      const coffreId = this.plugin.etat.coffreId, jeton = this.plugin.etat.jeton;
      const memeConnexion = () => !this.plugin.arret && this.plugin.etat.coffreId === coffreId && this.plugin.etat.jeton === jeton;
      const actif = () => !this.ferme && this.tour === tour && memeConnexion();
      c.empty();
      c.createEl('h3', { text: 'Mon profil' });
      c.createEl('p', { text: 'Ton nom et ta photo sont visibles par les membres du coffre.' });
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
        new O.Setting(c).setName('Nom affiché').setDesc('De 1 à 60 caractères.').addText((champ) => {
          champNom = champ;
          champ.setValue(saisieNom).onChange((valeur) => { saisieNom = valeur; });
          champ.inputEl.maxLength = 60;
        }).addButton((b) => { enregistrerNom = b; b.setButtonText('Enregistrer le nom').setCta().onClick(async () => {
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
        const photo = c.createEl('details', { cls: 'cordee-section' });
        photo.createEl('summary', { text: 'Photo de profil' });
        photo.createEl('p', { text: 'Recadrée sur cet appareil, sans métadonnées.', cls: 'cordee-details' });
        photo.createEl('label', { text: 'Choisir une photo (JPEG, PNG ou WebP, 10 Mo maximum)', cls: 'cordee-details' });
        const fichier = photo.createEl('input', { type: 'file', cls: 'cordee-choix-photo', attr: { accept: 'image/jpeg,image/png,image/webp', 'aria-label': 'Choisir ma photo de profil' } });
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
        new O.Setting(photo).addButton((b) => { enregistrer = b; b.setButtonText('Enregistrer la photo').onClick(() => choix && sauver(choix)); }).addButton((b) => { retirer = b; b.setButtonText('Retirer la photo').onClick(() => actuel && sauver(null)); });
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
      preparerPageSecondaire(this);
      const c = this.contentEl, p = this.plugin;
      this.ferme = false; const tour = this.tour = (this.tour || 0) + 1;
      const coffreId = p.etat.coffreId, jeton = p.etat.jeton;
      const actif = () => !this.ferme && this.tour === tour && !p.arret && p.etat.coffreId === coffreId && p.etat.jeton === jeton;

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
          zone.createEl('p', { text: r.raison === 'dossier' ? 'Ce dossier ne contient pas de texte à comparer.' : r.raison === 'volumineux' ? 'Ce fichier dépasse la limite de comparaison de 256 Ko.' : r.raison === 'indisponible' ? 'Une version historique manque sur le serveur.' : 'La comparaison est réservée aux notes texte.', cls: 'cordee-vide' });
        } else {
          diff = calculerDiff(r.avant ?? '', r.apres ?? '');
          if (diff.limite) zone.createEl('p', { text: 'Cette note est trop longue pour une comparaison détaillée.', cls: 'cordee-vide' });
          else {
            const ajouts = diff.lignes.filter((l) => l.type === 'ajout').length, suppressions = diff.lignes.filter((l) => l.type === 'suppression').length;
            const resume = zone.createEl('div', { cls: 'cordee-diff-resume' });
            resume.createEl('span', { text: `+${ajouts} ajout${ajouts > 1 ? 's' : ''}`, cls: 'cordee-compte-ajout' });
            resume.createEl('span', { text: `−${suppressions} suppression${suppressions > 1 ? 's' : ''}`, cls: 'cordee-compte-suppression' });
            if (!ajouts && !suppressions) zone.createEl('p', { text: 'Aucune différence textuelle entre ces deux versions.', cls: 'cordee-vide' });
            else {
              zone.createEl('p', { text: 'Rouge : avant · Vert : après.', cls: 'cordee-details' });
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
            else retour.setText('Note ouverte, sans sélection automatique du bloc.');
          } catch { if (actif()) retour.setText('Impossible d’ouvrir cette note sur cet appareil.'); }
        }, { cls: 'cordee-bouton-principal' });
        // Remonter le temps : deux clics (le premier demande confirmation), puis la version part chez tous.
        if (ch.type !== 'dossier') {
          const restauration = zone.createEl('details', { cls: 'cordee-section cordee-restaurer' });
          restauration.createEl('summary', { text: 'Restaurer une version' });
          const actions = restauration.createEl('div', { cls: 'cordee-commandes' });
          const proposer = (texte, hash) => {
            let arme = false;
            const bouton = boutonCordee(actions, texte, async () => {
              if (!arme) { arme = true; bouton.setText('Confirmer : remplacer la version actuelle'); bouton.setAttribute('aria-label', 'Confirmer : remplacer la version actuelle par celle-ci'); bouton.addClass?.('cordee-bouton-danger'); return; }
              bouton.disabled = true;
              try { await p.restaurer(ch.chemin, hash); if (actif()) retour.setText('Version restaurée et bientôt partagée ; la précédente reste dans l’historique.'); }
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
      const titres = entete.createEl('div', { cls: 'cordee-titres' });
      titres.createEl('h2', { text: `Coffre partagé : ${plugin.etat.nomCoffre || 'Notre coffre'}`, cls: 'cordee-titre' });
      this.resumePresence = titres.createEl('p', { cls: 'cordee-presence-resume' });
      const commandes = entete.createEl('div', { cls: 'cordee-commandes' });
      boutonCordee(commandes, 'Inviter', () => plugin.inviter(), { label: 'Créer une invitation', cls: 'cordee-bouton-principal' });
      boutonCordee(commandes, 'Mon profil', () => new ProfilModal(app, plugin).open(), { icone: 'user', cls: 'cordee-bouton-discret' });
      if (configurer) boutonCordee(commandes, 'Configurer', configurer, { icone: 'settings', cls: 'cordee-bouton-discret' });
      const etat = tableau.createEl('div', { cls: 'cordee-tableau-etat' });
      const statut = etat.createEl('span', { cls: 'cordee-statut', attr: { role: 'status' } });
      const pause = boutonCordee(etat, '', () => plugin.mettreEnPause(!plugin.etat.enPause), { label: 'Pause ou reprise', cls: 'cordee-bouton-discret' });
      boutonCordee(etat, 'Synchroniser', () => plugin.lancer({ forcer: true }), { icone: 'refresh-cw', cls: 'cordee-bouton-discret' });
      // Jauge du disque du serveur : on voit d'un coup d'œil s'il se remplit.
      const jauge = tableau.createEl('div', { cls: 'cordee-stockage' });
      jauge.hidden = true;
      const jaugeTexte = jauge.createEl('div', { cls: 'cordee-stockage-texte' });
      const jaugeBarre = jauge.createEl('div', { cls: 'cordee-stockage-barre' }).createEl('div', { cls: 'cordee-stockage-rempli' });
      this.afficherStockage = async () => {
        const st = await plugin.lireStockage?.();
        if (this.detruit || !st || !(st.total > 0)) { jauge.hidden = true; return; }
        const pris = st.total - st.libre, part = Math.min(100, Math.round((pris / st.total) * 100));
        jauge.hidden = false;
        jaugeBarre.style?.setProperty?.('width', part + '%');
        jauge.setAttribute('data-niveau', part >= 90 ? 'plein' : part >= 75 ? 'haut' : 'ok');
        texteSiChange(jaugeTexte, `Serveur ${part} % plein · ${octetsLisibles(st.libre)} libres · ce coffre ${octetsLisibles(st.coffre)}`);
      };
      this.afficherStockage();
      const attention = tableau.createEl('p', { cls: 'cordee-attention', attr: { role: 'status' } });
      const jour = accordeon(tableau, 'jour', 'Aujourd’hui');
      boutonCordee(jour.actions, 'La semaine', () => plugin.ouvrirSemaine(), { icone: 'calendar', cls: 'cordee-bouton-discret' });
      this.aujourdhuiEl = jour.corps.createEl('div', { cls: 'cordee-aujourdhui-liste' });
      this.desabonnerCalendrier = plugin.surCalendrier?.(() => this.afficherAujourdhui());
      this.chargementJour = this.afficherAujourdhui();
      const voir = accordeon(tableau, 'a-voir', 'À voir');
      this.titreAVoir = voir.titre;
      this.boutonToutVu = boutonCordee(voir.actions, 'Tout vu', () => plugin.toutMarquerVu(), { label: 'Tout marquer comme vu', icone: 'check', cls: 'cordee-bouton-discret' });
      this.aVoirEl = voir.corps.createEl('div', { cls: 'cordee-a-voir' });
      this.desabonner = plugin.abonnerStatut(() => {
        this.afficherAVoir();
        rafraichirPresenceTableau(this);
        // Changer de note ne modifie que la présence, pas la liste d'activité.
        const presence = this.signaturePresence();
        if (this.revChargee !== undefined && plugin.phase !== 'synchro' && (plugin.etat.derniereRev !== this.revChargee || presence !== this.presenceChargee)) this.charger();
        texteSiChange(statut, plugin.titreStatut()); attributSiChange(statut, 'title', plugin.titreStatut()); attributSiChange(statut, 'data-etat', plugin.etatCourt()); 
        const libellePause = plugin.etat.enPause ? 'Reprendre' : 'Mettre en pause';
        if (pause.getAttribute('aria-label') !== libellePause) {
          afficherIconeBouton(pause, plugin.etat.enPause ? 'play' : 'pause', libellePause);
          attributSiChange(pause, 'aria-label', libellePause);
          attributSiChange(pause, 'title', libellePause);
        }
        texteSiChange(attention, plugin.derniereErreur || plugin.texteBloques?.() || (plugin.suppressionsBloquees ? `${plugin.suppressionsBloquees} suppressions attendent ta confirmation (commande « Confirmer les suppressions en attente »).` : plugin.fichiersTropGros.size ? `${plugin.fichiersTropGros.size} fichier(s) de plus de 50 Mo n’ont pas été envoyés.` : '')); attention.hidden = !attention.textContent;
      });
      this.discussion = accordeon(tableau, 'discussion', 'Discussion');
      this.messagesEl = this.discussion.corps.createEl('div', { cls: 'cordee-messages', attr: { role: 'log', 'aria-label': 'Messages de la cordée', 'aria-live': 'polite' } });
      this.etatDiscussion = this.discussion.corps.createEl('p', { cls: 'cordee-details', attr: { role: 'status' } });
      this.formulaireDiscussion = this.discussion.corps.createEl('div', { cls: 'cordee-discussion-saisie' });
      this.saisieDiscussion = this.formulaireDiscussion.createEl('textarea', { attr: { rows: '2', maxlength: '2000', placeholder: 'Écris à ta cordée…', 'aria-label': 'Ton message' } });
      this.envoyerDiscussion = boutonCordee(this.formulaireDiscussion, 'Envoyer', () => this.envoyerMessage(), { cls: 'cordee-bouton-discret' });
      this.saisieDiscussion.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); return this.envoyerMessage(); }
      };
      plugin.tableauxDiscussion.add(this);
      this.afficherDiscussion();
      this.chargementDiscussion = plugin.rafraichirDiscussion();
      const membres = accordeon(tableau, 'membres', 'Membres');
      this.nombre = membres.actions.createEl('span', { cls: 'cordee-details' });
      this.membresEl = membres.corps.createEl('div', { cls: 'cordee-collegues', attr: { 'aria-label': 'Filtrer par membre' } });
      const activite = accordeon(tableau, 'activite', 'Derniers changements');
      this.titreActivite = activite.titre;
      boutonCordee(activite.actions, 'Actualiser', () => this.charger(), { icone: 'rotate-cw', cls: 'cordee-bouton-discret' });
      this.recherche = activite.corps.createEl('input', { cls: 'cordee-filtre-activite', attr: { type: 'search', placeholder: 'Filtrer…', 'aria-label': 'Filtrer les chemins' } });
      this.recherche.oninput = () => this.filtrerChemins();
      this.information = activite.corps.createEl('p', { cls: 'cordee-details' });
      this.zone = activite.corps.createEl('div', { cls: 'cordee-fichiers', attr: { 'aria-live': 'polite' } });
      this.chargement = Promise.all([this.charger(), this.chargementDiscussion]);
    }
    actif() { return !this.detruit && !this.plugin.arret && this.plugin.etat.coffreId === this.coffreId && this.plugin.etat.jeton === this.jeton; }
    discussionVisible() {
      if (!this.actif() || globalThis.document?.hidden || !this.discussion.corps.parentElement.open) return false;
      return this.c.isShown ? this.c.isShown() : this.c.getClientRects ? this.c.getClientRects().length > 0 : this.c.isConnected !== false;
    }
    afficherDiscussion() {
      if (!this.actif()) return;
      const discussion = this.plugin.discussionCourante();
      const signature = JSON.stringify([discussion.messages, discussion.moiId]);
      // La saisie et son curseur survivent aux messages reçus et au sondage.
      if (signature !== this.signatureDiscussion) {
        this.signatureDiscussion = signature;
        this.messagesEl.empty();
        for (const message of discussion.messages) {
          const bulle = this.messagesEl.createEl('div', { cls: 'cordee-message' + (message.auteurId === discussion.moiId ? ' cordee-message-moi' : '') });
          bulle.createEl('span', { cls: 'cordee-message-auteur' }).setText(`${message.auteur || 'Membre'} · ${heure(message.le)}`);
          bulle.createEl('div', { cls: 'cordee-message-texte' }).setText(message.texte);
        }
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      }
      texteSiChange(this.etatDiscussion, discussion.ancienne ? 'Mets le serveur à jour pour discuter' : discussion.erreur || (!discussion.chargee ? 'Chargement de la discussion…' : !discussion.messages.length ? 'Écris le premier message.' : ''));
      this.formulaireDiscussion.hidden = !!discussion.ancienne;
    }
    async envoyerMessage() {
      if (!this.actif() || this.envoiMessage) return;
      const texte = this.saisieDiscussion.value.trim();
      if (!texte.length || texte.length > 2000) { this.etatDiscussion.setText('Écris entre 1 et 2000 caractères.'); return; }
      const discussion = this.plugin.discussionCourante();
      const brouillon = this.saisieDiscussion.value;
      this.envoiMessage = true; this.envoyerDiscussion.disabled = true;
      try {
        const message = await (await this.plugin.moteur.api('POST', `/api/coffres/${this.coffreId}/messages`, { texte })).json();
        if (!this.actif() || this.plugin.discussionCourante() !== discussion) return;
        // Une frappe pendant l'envoi appartient au prochain message.
        if (this.saisieDiscussion.value === brouillon) this.saisieDiscussion.value = '';
        discussion.moiId = message.auteurId;
        await this.plugin.rafraichirDiscussion(message.id);
        if (this.actif()) this.saisieDiscussion.focus?.();
      } catch (erreur) {
        if (!this.actif()) return;
        if (erreur.statut === 404) { discussion.ancienne = true; this.plugin.afficherDiscussion(); }
        else this.etatDiscussion.setText(erreur.statut === 429 ? 'Trop de messages. Patiente une minute.' : expliquerErreur(erreur));
      } finally { this.envoiMessage = false; this.envoyerDiscussion.disabled = false; }
    }
    signaturePresence() { return JSON.stringify((this.plugin.presence || []).map((p) => [p.id, p.nom])); }
    filtrerChemins() {
      // Filtrer les cartes déjà reçues évite une requête à chaque frappe.
      const normaliser = (texte) => texte.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr');
      const filtre = normaliser(this.recherche.value.trim());
      for (const { carte } of this.cartesActivite?.values() || []) carte.hidden = !normaliser(carte.getAttribute('title') || '').includes(filtre);
    }
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
        zone.createEl('p', { text: p.etat.calendriers.length ? 'Rien à venir, aucun devoir cette semaine.' : 'Ajoute tes calendriers dans les réglages.', cls: 'cordee-vide' });
        return;
      }
      for (const e of [...restants, ...echeances]) {
        const b = boutonCordee(zone, '', () => new EvenementModal(this.app, p, e).open(), { label: e.titre, cls: 'cordee-evenement-ligne' });
        b.style?.setProperty?.('--cordee-couleur', e.couleur);
        const quand = estEcheance(e) ? `${e.rendu ? 'Rendu' : 'À rendre'} ${new Date(e.debut).toLocaleDateString('fr-FR', { weekday: 'short' })} ${heure(e.debut)}` : e.journee ? 'Journée' : `${heure(e.debut)}–${heure(e.fin)}`;
        b.createEl('span', { text: quand, cls: 'cordee-evenement-heure' });
        const t = b.createEl('span', { cls: 'cordee-evenement-texte' });
        t.createEl('strong', { text: e.titre });
        if (e.lieu) t.createEl('span', { text: e.lieu, cls: 'cordee-details' });
        if (!estEcheance(e) && !e.journee) {
          const avant = e.debut - maintenant;
          const bientot = avant <= 0 ? 'En cours' : avant < 3 * 3600_000 ? `Dans ${avant < 3600_000 ? Math.ceil(avant / 60_000) + ' min' : Math.floor(avant / 3600_000) + ' h ' + String(Math.floor((avant % 3600_000) / 60_000)).padStart(2, '0')}` : '';
          if (bientot) t.createEl('span', { text: bientot, cls: 'cordee-evenement-bientot' });
        }
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
      if (!entrees.length) { zone.createEl('p', { text: 'Tu as tout vu.', cls: 'cordee-vide' }); return; }
      for (const [chemin, e] of entrees.slice(0, 30)) {
        const ligne = zone.createEl('div', { cls: 'cordee-a-voir-ligne' + (e.ouvert ? '' : ' cordee-non-ouvert') });
        ligne.style?.setProperty?.('--cordee-couleur', couleurAuteur(e.auteurs?.[0]));
        const ouvrir = boutonCordee(ligne, '', async () => { try { await p.ouvrirModif(chemin); } catch { new O.Notice(`Impossible d’ouvrir ${chemin}.`); } }, { label: `Ouvrir ${chemin} sur les modifications`, cls: 'cordee-a-voir-ouvrir', attr: { title: chemin } });
        const tete = ouvrir.createEl('span', { cls: 'cordee-fichier-tete' });
        tete.createEl('strong', { text: nomFichier(chemin), cls: 'cordee-fichier-chemin' });
        if (dossierDe(chemin)) tete.createEl('span', { text: dossierDe(chemin), cls: 'cordee-fichier-dossier' });
        ouvrir.createEl('span', { text: resumeModif(e), cls: 'cordee-details' });
        boutonCordee(ligne, 'Vu', () => p.marquerVu(chemin), { label: `Marquer ${chemin} comme vu`, cls: 'cordee-bouton-discret cordee-bouton-vu' });
      }
      if (entrees.length > 30) zone.createEl('p', { text: `Et ${entrees.length - 30} autre(s).`, cls: 'cordee-details' });
    }
    async charger() {
      this.afficherStockage?.(); // la jauge suit les envois (lecture gardée 1 min)
      if (!this.actif()) return;
      this.revChargee = this.plugin.etat.derniereRev; this.presenceChargee = this.signaturePresence();
      const tour = this.tour = (this.tour || 0) + 1;
      const filtre = this.filtre;
      if (!this.chargee) { this.zone.empty(); this.zone.createEl('p', { text: 'Chargement de l’activité…', cls: 'cordee-vide' }); }
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
        texteSiChange(this.nombre, `${info.membres.length} membre${info.membres.length > 1 ? 's' : ''}`);
        this.membresPresence = info.membres; this.moiPresence = info.moiId; this.lignesPresence = [];
        if (!this.tous) {
          this.tous = boutonCordee(this.membresEl, 'Tous', () => { this.filtre = null; return this.charger(); }, { cls: 'cordee-collegue cordee-collegue-tous' });
        }
        attributSiChange(this.tous, 'aria-pressed', String(!filtre));
        const membres = new Map(), elementsMembres = [this.tous];
        for (const [i, membre] of info.membres.entries()) {
          const cle = membre.id ? 'id:' + membre.id : 'ancien:' + i;
          const profil = JSON.stringify([membre.nom, membre.avatar]);
          let ligne = this.cartesMembres?.get(cle);
          if (!ligne || ligne.profil !== profil) {
            const filtrer = () => { this.filtre = membre.id; return this.charger(); };
            const bouton = boutonCordee(this.membresEl, '', (evt) => {
              const actuel = ligne?.membre || membre;
              if (!O.Menu) return filtrer();
              const menu = new O.Menu();
              menu.addItem((i) => i.setTitle('Voir sa fiche').setIcon('user').onClick(() => new FicheMembreModal(this.app, this.plugin, actuel, { statut: ligne?.statut?.textContent || '', compte: ligne?.compte?.textContent || '', moi: actuel.id === this.moiPresence, filtrer }).open()));
              menu.addItem((i) => i.setTitle('Voir ses changements').setIcon('filter').onClick(filtrer));
              if (actuel.id === this.moiPresence) menu.addItem((i) => i.setTitle('Modifier mon profil').setIcon('settings').onClick(() => new ProfilModal(this.app, this.plugin).open()));
              if (evt?.clientX !== undefined && evt.clientX + evt.clientY > 0) menu.showAtMouseEvent(evt);
              else { const r = bouton.getBoundingClientRect(); menu.showAtPosition({ x: r.left, y: r.bottom }); }
            }, { label: `Voir les changements de ${membre.nom}`, cls: 'cordee-collegue', attr: { 'data-membre-id': membre.id || '' } });
            bouton.disabled = !membre.id;
            afficherAvatar(bouton, membre.nom, membre.avatar);
            const identite = bouton.createEl('span', { cls: 'cordee-collegue-identite' });
            identite.createEl('strong', { text: membre.nom });
            ligne = { bouton, profil, statut: identite.createEl('span', { cls: 'cordee-presence-membre' }), compte: identite.createEl('span', { cls: 'cordee-details' }) };
          }
          ligne.membre = membre;
          attributSiChange(ligne.bouton, 'aria-pressed', String(filtre === membre.id));
          const n = this.comptes.get(membre.id) || 0;
          texteSiChange(ligne.compte, membre.id ? (n ? `${n} changement${n > 1 ? 's' : ''} récent${n > 1 ? 's' : ''}` : 'Rien de récent') : 'Membre du groupe');
          this.lignesPresence.push(ligne); membres.set(cle, ligne); elementsMembres.push(ligne.bouton);
        }
        reconcilierListe(this.membresEl, elementsMembres); this.cartesMembres = membres;
        rafraichirPresenceTableau(this);
        const selection = info.membres.find((m) => m.id === filtre);
        texteSiChange(this.titreActivite, filtre ? `Changements de ${selection?.nom || 'ce membre'}` : 'Derniers changements');
        texteSiChange(this.information, ancien ? 'Mets le serveur Cordée à jour pour comparer les versions.' : '40 changements maximum');
        const changements = info.changements.filter((ch) => !filtre || ch.auteurId === filtre).slice(0, 40);
        const cartes = new Map(), elements = [];
        if (!changements.length) {
          this.videActivite ||= this.zone.createEl('div', { cls: 'cordee-vide' });
          texteSiChange(this.videActivite, filtre ? 'Aucun changement récent pour ce membre.' : 'Aucun changement partagé pour le moment.');
          elements.push(this.videActivite);
        }
        const profils = new Map(info.membres.filter((m) => m.id).map((m) => [m.id, m]));
        for (const [i, ch] of changements.entries()) {
          const cle = Number.isSafeInteger(ch.rev) ? 'rev:' + ch.rev : 'ancien:' + i;
          const signature = JSON.stringify([ch, profils.get(ch.auteurId)?.avatar, ancien]);
          const precedente = this.cartesActivite?.get(cle);
          if (precedente?.signature === signature) {
            texteSiChange(precedente.auteur, `${ch.auteur || 'Membre'} · ${ch.supprime ? 'a supprimé' : 'a modifié'} ${nomFichier(ch.chemin)} · ${ilYa(ch.le)}`);
            cartes.set(cle, precedente); elements.push(precedente.carte); continue;
          }
          const carte = boutonCordee(this.zone, '', () => new RevisionModal(this.app, this.plugin, ch.rev, profils.get(ch.auteurId)).open(), { label: `Comparer ${ch.chemin}, révision ${ch.rev}`, cls: 'cordee-fichier', attr: { 'data-revision': String(ch.rev), title: ch.chemin } });
          carte.disabled = ancien || !Number.isSafeInteger(ch.rev);
          afficherAvatar(carte, ch.auteur, profils.get(ch.auteurId)?.avatar);
          const contenu = carte.createEl('span', { cls: 'cordee-fichier-contenu' });
          const tete = contenu.createEl('span', { cls: 'cordee-fichier-tete' });
          tete.createEl('strong', { text: nomFichier(ch.chemin), cls: 'cordee-fichier-chemin' });
          if (dossierDe(ch.chemin)) tete.createEl('span', { text: dossierDe(ch.chemin), cls: 'cordee-fichier-dossier' });
          const auteur = contenu.createEl('span', { text: `${ch.auteur || 'Membre'} · ${ch.supprime ? 'a supprimé' : 'a modifié'} ${nomFichier(ch.chemin)} · ${ilYa(ch.le)}`, cls: 'cordee-fichier-auteur', attr: { title: new Date(ch.le).toLocaleString('fr-FR') } });
          const genre = ch.type === 'dossier' ? 'dossier' : ch.supprime ? 'supprime' : ch.avantHash ? 'modifie' : 'ajoute';
          carte.createEl('span', { text: { dossier: 'Dossier', supprime: 'Supprimé', modifie: 'Modifié', ajoute: 'Ajouté' }[genre], cls: `cordee-type-changement cordee-type-${genre}` });
          carte.createEl('span', { text: '↗', cls: 'cordee-fichier-fleche', attr: { 'aria-hidden': 'true' } });
          cartes.set(cle, { signature, carte, auteur }); elements.push(carte);
        }
        reconcilierListe(this.zone, elements); this.cartesActivite = cartes; this.chargee = true;
        this.filtrerChemins();
      } catch (erreur) { if (this.actif() && this.tour === tour) {
        if (this.chargee) texteSiChange(this.information, 'Actualisation impossible : ' + expliquerErreur(erreur));
        else { this.zone.empty(); this.zone.createEl('p', { text: expliquerErreur(erreur), cls: 'cordee-vide' }); }
      } }
    }
    detruire() { this.detruit = true; ++this.tour; this.plugin.tableauxDiscussion.delete(this); this.desabonner?.(); this.desabonnerCalendrier?.(); }
  }

  /** Toutes les versions d'une note : qui, quand, combien de lignes ; un clic compare et permet de restaurer. */
  HistoriqueModal = class extends O.Modal {
    constructor(app, plugin, chemin) { super(app); this.plugin = plugin; this.chemin = chemin; }
    async onOpen() {
      preparerPageSecondaire(this);
      const c = this.contentEl, p = this.plugin;
      this.ferme = false;

      c.empty(); c.createEl('div', { text: 'HISTORIQUE', cls: 'cordee-surtitre' });
      c.createEl('h2', { text: nomFichier(this.chemin), cls: 'cordee-titre' });
      if (dossierDe(this.chemin)) c.createEl('div', { text: dossierDe(this.chemin), cls: 'cordee-details' });
      const zone = c.createEl('div', { cls: 'cordee-historique', attr: { 'aria-live': 'polite' } });
      zone.createEl('p', { text: 'Chargement des versions…', cls: 'cordee-vide' });
      if (!p.connecte()) { zone.empty(); zone.createEl('p', { text: 'Rejoins un coffre pour voir l’historique.', cls: 'cordee-vide' }); return; }
      try {
        const r = await (await p.moteur.api('GET', `/api/coffres/${p.etat.coffreId}/historique?chemin=${encodeURIComponent(this.chemin)}&limite=50`)).json();
        if (this.ferme) return;
        zone.empty();
        if (!r.changements.length) { zone.createEl('p', { text: 'Pas encore de version partagée pour cette note.', cls: 'cordee-vide' }); return; }
        const profils = new Map((r.membres || []).map((m) => [m.id, m]));
        r.changements.forEach((ch, i) => {
          const carte = boutonCordee(zone, '', () => new RevisionModal(this.app, p, ch.rev, profils.get(ch.auteurId)).open(), { label: `Comparer la révision ${ch.rev}`, cls: 'cordee-historique-ligne' + (i === 0 ? ' cordee-bouton-principal' : '') });
          afficherAvatar(carte, ch.auteur, profils.get(ch.auteurId)?.avatar);
          const contenu = carte.createEl('span', { cls: 'cordee-historique-contenu' });
          contenu.createEl('strong', { text: `${ch.auteur || 'Membre'} · ${ilYa(ch.le)}`, cls: 'cordee-historique-auteur' });
          contenu.createEl('span', { text: `${new Date(ch.le).toLocaleString('fr-FR')} · révision ${ch.rev}${i === 0 ? ' · version actuelle' : ''}`, cls: 'cordee-historique-date' });
          const genre = ch.supprime ? 'supprime' : ch.avantHash ? 'modifie' : 'ajoute';
          carte.createEl('span', { text: { supprime: 'Supprimé', modifie: 'Modifié', ajoute: 'Créé' }[genre], cls: `cordee-type-changement cordee-type-${genre}` });
        });
        c.createEl('p', { text: 'Choisis une version pour la comparer.', cls: 'cordee-details' });
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
        c.createEl('p', { text: 'Rejoins une cordée ou partage ton coffre.', cls: 'cordee-vide' });
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
    boutonCordee(nav, '‹', () => changer(decalerJours(debut, -7)), { label: 'Semaine précédente', icone: 'chevron-left', cls: 'cordee-bouton-discret' });
    boutonCordee(nav, 'Aujourd’hui', () => changer(debutSemaine(Date.now())), { cls: 'cordee-bouton-discret' });
    boutonCordee(nav, '›', () => changer(decalerJours(debut, 7)), { label: 'Semaine suivante', icone: 'chevron-right', cls: 'cordee-bouton-discret' });
    const d0 = new Date(jours[0]), d6 = new Date(jours[6]);
    tete.createEl('h2', { text: `Semaine du ${d0.toLocaleDateString('fr-FR', { day: 'numeric', month: d0.getMonth() === d6.getMonth() ? undefined : 'long' })} au ${d6.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`, cls: 'cordee-titre' });
    const actions = tete.createEl('div', { cls: 'cordee-commandes' });
    boutonCordee(actions, 'Ajouter un créneau', () => new CreneauModal(plugin.app, plugin, jourIso(Math.max(debut, Date.now()))).open(), { cls: 'cordee-bouton-principal' });
    boutonCordee(actions, 'Actualiser', () => plugin.actualiserCalendriers({ forcer: true }), { icone: 'refresh-cw', cls: 'cordee-bouton-discret' });

    const legende = c.createEl('div', { cls: 'cordee-legende' });
    const toutes = plugin.toutesSources(await plugin.texteAgenda());
    const sources = [...toutes.map((s) => ({ nom: s.partage ? `${s.nom} (cordée)` : s.nom, type: s.type })), { nom: 'Agenda de la cordée', type: 'cordee' }];
    for (const s of sources) { const l = legende.createEl('span', { text: s.nom, cls: 'cordee-legende-source' }); l.style?.setProperty?.('--cordee-couleur', COULEURS_CALENDRIER[s.type] || COULEURS_CALENDRIER.autre); }
    for (const s of toutes) {
      const cache = plugin.etat.cacheCalendriers[s.id];
      if (cache?.erreur) c.createEl('p', { text: `${s.nom} : ${cache.erreur}.${cache.maj ? ` Dernière version gardée (${ilYa(cache.maj)}).` : ''}`, cls: 'cordee-attention' });
    }
    if (!toutes.length) {
      const vide = c.createEl('div', { cls: 'cordee-semaine-vide' });
      vide.createEl('p', { text: 'Ajoute ton emploi du temps ou tes échéances Moodle dans les réglages.', cls: 'cordee-details' });
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
        const b = boutonCordee(cellule, estEcheance(e) ? `${e.rendu ? 'Rendu' : 'À rendre'} ${heure(e.debut)} · ${e.titre}` : e.titre, () => ouvrir(e), { cls: 'cordee-pastille' + (estEcheance(e) ? ' cordee-echeance' : '') + (e.rendu ? ' cordee-echeance-rendue' : '') });
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
        // La hauteur suit la durée réelle pour ne pas recouvrir le créneau suivant.
        const de = Math.max(e.debut, origine.getTime()), a = Math.min(e.fin, fin.getTime());
        const b = boutonCordee(colonne, '', () => ouvrir(e), { label: `${e.titre}, ${heure(e.debut)} à ${heure(e.fin)}${e.lieu ? ', ' + e.lieu : ''}`, cls: 'cordee-evenement' + (a - de < 30 * 60_000 ? ' cordee-evenement-court' : '') });
        b.setAttribute('title', b.getAttribute('aria-label'));
        if (b.style) Object.assign(b.style, { top: `${(de - origine.getTime()) / etendue * 100}%`, height: `${Math.max(0, (a - de) / etendue * 100)}%`, left: `${rang / colonnes * 100}%`, width: `${100 / colonnes}%` });
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
        b.createEl('span', { text: e.journee ? 'Journée' : estEcheance(e) ? `${e.rendu ? 'Rendu' : 'À rendre'} ${heure(e.debut)}` : `${heure(e.debut)}–${heure(e.fin)}`, cls: 'cordee-evenement-heure' });
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
      preparerPageSecondaire(this);
      const c = this.contentEl, e = this.e, p = this.plugin;
      c.empty();
      const sur = c.createEl('div', { text: (LIBELLES_SOURCE[e.type] || 'Calendrier').toUpperCase(), cls: 'cordee-surtitre' });
      sur.style?.setProperty?.('color', e.couleur);
      c.createEl('h2', { text: e.titre, cls: 'cordee-titre' });
      const date = new Date(e.debut).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      c.createEl('p', { text: e.journee ? `${date} · toute la journée` : estEcheance(e) ? `À rendre le ${date} à ${heure(e.debut)}` : `${date} · ${heure(e.debut)}–${heure(e.fin)}`, cls: 'cordee-evenement-quand' });
      if (e.lieu) c.createEl('p', { text: `Où : ${e.lieu}`, cls: 'cordee-details' });
      if (e.auteur) c.createEl('p', { text: `Ajouté par ${e.auteur}`, cls: 'cordee-details' });
      if (e.description) {
        const details = c.createEl('details', { cls: 'cordee-section' });
        details.createEl('summary', { text: 'Description' });
        details.createEl('p', { text: e.description, cls: 'cordee-evenement-description' });
      }
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
      preparerPageSecondaire(this);
      const c = this.contentEl, v = this.valeurs, p = this.plugin;
      c.empty();
      c.createEl('div', { text: 'AGENDA DE LA CORDÉE', cls: 'cordee-surtitre' });
      c.createEl('h2', { text: 'Ajouter un créneau', cls: 'cordee-titre' });
      c.createEl('p', { text: 'Ce créneau sera visible par toute la cordée.', cls: 'cordee-details' });
      const formulaire = c.createEl('div', { cls: 'cordee-formulaire' });
      const champ = (libelle, cle, type, attr = {}, parent = formulaire) => {
        const l = parent.createEl('label', { cls: 'cordee-champ' });
        l.createEl('span', { text: libelle });
        const input = l.createEl('input', { attr: { type, value: v[cle] || '', ...attr } });
        input.value = v[cle] || '';
        input.addEventListener?.('input', () => { v[cle] = input.value; });
        this.champs = { ...(this.champs || {}), [cle]: input };
        return input;
      };
      champ('Quoi', 'titre', 'text', { placeholder: 'Révision ENER3', maxlength: '120' });
      champ('Jour', 'jour', 'date');
      const precisions = c.createEl('details', { cls: 'cordee-section' });
      precisions.open = !!(v.debut || v.fin || v.lieu);
      precisions.createEl('summary', { text: 'Heures et lieu' });
      const horaires = precisions.createEl('div', { cls: 'cordee-formulaire cordee-formulaire-horaires' });
      champ('Début (facultatif)', 'debut', 'time', {}, horaires);
      champ('Fin (facultatif)', 'fin', 'time', {}, horaires);
      champ('Où (facultatif)', 'lieu', 'text', { placeholder: 'BU, salle, en ligne…', maxlength: '80' }, horaires);
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
      c.createEl('p', { text: 'Ajoute un lien iCal pour voir tes cours et échéances dans la Semaine.', cls: 'cordee-details' });
      // Calendriers partagés : lus dans la note commune (lecture asynchrone, affichés dès qu'ils sont là).
      const zonePartages = c.createEl('div');
      p.texteAgenda().then((texte) => {
        for (const s of lireCalendriersPartages(texte)) {
          const cache = p.etat.cacheCalendriers[s.id];
          const etat = s.type === 'moodle' ? 'Ignoré : un lien Moodle est personnel, retire-le de la note' : cache?.erreur ? `Erreur : ${cache.erreur}` : cache?.maj ? `${cache.evenements.length} événements · mis à jour ${ilYa(cache.maj)}` : 'Pas encore lu';
          new O.Setting(zonePartages).setName(`${s.nom} · partagé avec la cordée`).setDesc(`${masquerUrl(s.url)} · ${etat}`)
            .addButton((b) => b.setButtonText('Retirer pour tous').onClick(async () => { await p.retirerCalendrierPartage(s.url); rafraichir(); }));
        }
      }).catch(() => { /* la note se relira au prochain affichage */ });
      for (const s of p.etat.calendriers) {
        const cache = p.etat.cacheCalendriers[s.id];
        const etat = cache?.erreur ? `Erreur : ${cache.erreur}` : cache?.maj ? `${cache.evenements.length} événements · mis à jour ${ilYa(cache.maj)}` : 'Pas encore lu';
        new O.Setting(c).setName(`${s.nom} · ${{ edt: 'emploi du temps', moodle: 'Moodle', autre: 'calendrier' }[s.type] || 'calendrier'}`).setDesc(`${masquerUrl(s.url)} · ${etat}`)
          .addButton((b) => b.setButtonText('Retirer').onClick(async () => { await p.retirerCalendrier(s.id); rafraichir(); }));
      }
      const f = this.formCalendrier || (this.formCalendrier = { nom: '', url: '' });
      new O.Setting(c).setName('Nom').addText((t) => t.setPlaceholder('Emploi du temps').setValue(f.nom).onChange((v) => { f.nom = v; }));
      new O.Setting(c).setName('Lien iCal').setDesc('Lien https:// ou webcal://, masqué pour protéger ta clé.').addText((t) => { t.inputEl.type = 'password'; t.setPlaceholder('https://…').setValue(f.url).onChange((v) => { f.url = v; }); });
      const ajouter = async (pourTous) => {
        try {
          const s = pourTous ? await p.ajouterCalendrierPourTous(f.nom, f.url) : await p.ajouterCalendrier(f.nom, f.url);
          const cache = p.etat.cacheCalendriers[s.id];
          const ou = pourTous ? ' pour toute la cordée' : '';
          new O.Notice(cache?.erreur ? `Cordée : « ${s.nom} » ajouté${ou}, mais lecture impossible (${cache.erreur}).` : `Cordée : « ${s.nom} » ajouté${ou} · ${cache?.evenements?.length || 0} événements.`);
          this.formCalendrier = { nom: '', url: '' };
          rafraichir();
        } catch (e) { new O.Notice('Cordée : ' + e.message); }
      };
      new O.Setting(c).addButton((b) => b.setButtonText('Ajouter pour moi').setCta().onClick(() => ajouter(false)));
      const partage = sectionRepliable(c, 'Partager un emploi du temps', 'partage-calendrier', this);
      new O.Setting(partage).setDesc('Réservé aux emplois du temps communs ; les liens Moodle restent personnels.')
        .addButton((b) => b.setButtonText('Ajouter pour toute la cordée').onClick(() => ajouter(true)));
      new O.Setting(c).setName('La semaine').addButton((b) => b.setButtonText('Ouvrir la semaine').onClick(() => p.ouvrirSemaine()));
    }
    hide() { this.nettoyer(); }
    afficherDans(c, rafraichir) {
      const p = this.plugin, e = p.etat, f = this.form;
      this.nettoyer();
      c.empty();
      c = c.createEl('div', { cls: 'cordee-reglages' });
      if (p.connecte()) {
        c.createEl('h3', { text: `Coffre partagé : ${e.nomCoffre}` });
        const identite = c.createEl('p');
        const statut = c.createEl('p', { cls: 'cordee-etat' });
        const chiffres = c.createEl('p', { cls: 'cordee-details' });
        const attention = c.createEl('p', { cls: 'cordee-attention' });
        let boutonPause;
        const automatique = new O.Setting(c).setName('Synchronisation automatique').addButton((b) => { boutonPause = b; b.onClick(async () => { await p.mettreEnPause(!e.enPause); }); });
        this.desabonner = p.abonnerStatut(() => {
          identite.setText(`${e.prenom} · ${e.serveur}`);
          boutonPause.setButtonText(e.enPause ? 'Reprendre' : 'Mettre en pause');
          automatique.setDesc(e.enPause ? 'Tes modifications restent locales jusqu’à la reprise.' : 'Tes modifications sont partagées automatiquement.');
          statut.setText(p.titreStatut());
          const derniere = e.derniereSynchro ? new Date(e.derniereSynchro).toLocaleString('fr-FR') : 'pas encore effectuée';
          chiffres.setText(`${Object.keys(e.bases).length} fichiers partagés · Dernière synchronisation : ${derniere}`);
          attention.setText(p.derniereErreur || p.texteBloques?.() || (p.suppressionsBloquees ? `${p.suppressionsBloquees} suppressions attendent ta confirmation (commande « Confirmer les suppressions en attente »).` : p.fichiersTropGros.size ? `${p.fichiersTropGros.size} fichier(s) dépassent la limite de 50 Mo et n’ont pas été envoyés.` : e.enPause ? 'Les prochaines synchronisations sont suspendues. Une opération déjà lancée se termine normalement.' : ''));
          attention.hidden = !attention.textContent;
        });
        // Les actions courantes tiennent sur une seule ligne au lieu de quatre réglages.
        new O.Setting(c.createEl('div', { cls: 'cordee-actions' }))
          .addButton((b) => b.setButtonText('Inviter').setCta().onClick(() => p.inviter()))
          .addButton((b) => b.setButtonText('Synchroniser').onClick(() => p.lancer({ forcer: true })))
          .addButton((b) => b.setButtonText('Activité').onClick(() => new ActiviteModal(this.app, p).open()))
          .addButton((b) => b.setButtonText('Mon profil').onClick(() => new ProfilModal(this.app, p).open()));
        const options = sectionRepliable(c, 'Options du coffre', 'coffre', this);
        new O.Setting(options).setName('Partager les vidéos').setDesc('Désactivé : les vidéos (mp4, mov…) restent sur cet appareil.').addToggle((t) => t.setValue(!!e.partagerVideos).onChange(async (v) => { e.partagerVideos = v; await p.saveData(e); p.programmer(0); }));
        new O.Setting(options).setName('Dossiers non partagés').setDesc('Séparés par des virgules : Brouillons, Perso').addText((t) => t.setValue(e.dossiersIgnores).onChange(async (v) => { e.dossiersIgnores = v; await p.saveData(e); }));
        new O.Setting(options).setName('Quitter ce coffre').setDesc('Tes fichiers restent sur cet appareil.').addButton((b) => b.setButtonText('Quitter').setWarning().onClick(async () => { await p.quitter(); rafraichir(); }));
        // Calendriers et Moodle sont repliés : on ne les règle qu'une fois.
        this.afficherCalendriers(sectionRepliable(c, 'Calendriers', 'calendriers', this), rafraichir);
        afficherReglagesMoodle(sectionRepliable(c, 'Moodle', 'moodle', this), p);
        return;
      }
      c.createEl('h3', { text: f.creer ? 'Créer un coffre partagé' : 'Rejoindre un coffre' });
      c.createEl('p', { text: 'Les notes de ce coffre seront partagées : pars de préférence d’un coffre vide.' });
      new O.Setting(c).setName('Nom affiché').setDesc('Visible par le groupe.').addText((t) => t.setValue(f.prenom).onChange((v) => { f.prenom = v; }));
      const serveur = new O.Setting(c).setName('Serveur').setDesc(f.serveur || 'Une invitation complète renseigne le serveur automatiquement.').addButton((b) => b.setButtonText('Changer de serveur').onClick(() => { f.adresseVisible = !f.adresseVisible; rafraichir(); }));
      let champServeur;
      if (f.adresseVisible || (!f.serveur && f.creer)) new O.Setting(c).setName('Adresse du serveur').addText((t) => { champServeur = t; t.setPlaceholder('https://cordee.exemple.fr').setValue(f.serveur).onChange((v) => { f.serveur = v.trim(); serveur.setDesc(f.serveur || 'Colle une invitation complète ou indique le serveur.'); }); });
      if (!f.creer) {
        new O.Setting(c).setName('Invitation ou code').setDesc('Colle ton invitation, ou le code si le serveur est renseigné.').addText((t) => t.setValue(f.invitation).onChange((v) => {
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
      }
      new O.Setting(sectionRepliable(c, 'Options de partage', 'exclusions', this)).setName('Dossiers non partagés').setDesc('À exclure avant l’envoi, séparés par des virgules.').addText((t) => t.setValue(f.dossiersIgnores).onChange((v) => { f.dossiersIgnores = v; }));
      if (!f.creer) {
        new O.Setting(c).setName('Partager ce coffre avec des amis').setDesc('Crée un nouveau groupe sur ton serveur.').addButton((b) => b.setButtonText('Créer un nouveau partage').onClick(() => { f.creer = true; rafraichir(); }));
        afficherReglagesMoodle(sectionRepliable(c, 'Moodle', 'moodle', this), p);
        return;
      }
      boutonCordee(c, 'Rejoindre avec une invitation', () => { f.creer = false; rafraichir(); }, { cls: 'cordee-bouton-discret' });
      c.createEl('p', { text: 'Demande le code de création à la personne qui héberge le serveur.' });
      new O.Setting(c).setName('Nom du coffre').addText((t) => t.setValue(f.nom).onChange((v) => { f.nom = v; }));
      new O.Setting(c).setName('Code de création').addText((t) => { t.inputEl.type = 'password'; t.onChange((v) => { f.code = v; }); });
      new O.Setting(c).addButton((b) => b.setButtonText('Créer et partager').setCta().onClick(async () => {
        if (!invitationValide(new URLSearchParams({ serveur: f.serveur, code: 'test' }))) { new O.Notice('Indique une adresse de serveur HTTP ou HTTPS valide.'); return; }
        if (!f.nom.trim() || !f.prenom.trim() || f.prenom.trim().length > 60 || !f.code.trim()) { new O.Notice('Indique le nom du coffre, ton nom affiché (1 à 60 caractères) et le code de création.'); return; }
        e.dossiersIgnores = f.dossiersIgnores;
        try { await p.rejoindreOuCreer('/api/coffres', { nom: f.nom.trim(), prenom: f.prenom.trim(), codeCreation: f.code.trim() }, f.serveur); rafraichir(); }
        catch (err) { new O.Notice('Cordée : ' + err.message); }
      }));
      afficherReglagesMoodle(sectionRepliable(c, 'Moodle', 'moodle', this), p);
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

/* ---------- Logiciels GEII ---------- */

// Ces lecteurs ne changent pas EXT_TEXTE : une fusion pourrait casser les
// connexions d'un schéma. En conflit, les fichiers GEII restent copiés en entier.
function lireAsc(source) {
  const schema = { fils: [], noeuds: [], symboles: [], textes: [] };
  let symbole = null;
  for (const ligne of source.split(/\r?\n/)) {
    let m;
    const coord = valeurs => valeurs.every(v => Number.isFinite(+v) && Math.abs(+v) <= 1e7);
    if ((m = /^WIRE\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*$/.exec(ligne)) && coord(m.slice(1))) schema.fils.push(m.slice(1).map(Number));
    else if ((m = /^FLAG\s+(-?\d+)\s+(-?\d+)\s+(.+)$/.exec(ligne)) && coord(m.slice(1, 3))) schema.noeuds.push({ x: +m[1], y: +m[2], nom: m[3] });
    else if ((m = /^SYMBOL\s+(\S+)\s+(-?\d+)\s+(-?\d+)(?:\s+(\S+))?/.exec(ligne)) && coord(m.slice(2, 4))) {
      symbole = { type: m[1], x: +m[2], y: +m[3], orientation: m[4] || 'R0', nom: '', valeur: '' }; schema.symboles.push(symbole);
    } else if ((m = /^SYMATTR\s+(InstName|Value)\s+(.+)$/.exec(ligne)) && symbole) symbole[m[1] === 'InstName' ? 'nom' : 'valeur'] = m[2];
    else if ((m = /^TEXT\s+(-?\d+)\s+(-?\d+)\s+\S+\s+\d+\s+([\s\S]*)$/.exec(ligne)) && coord(m.slice(1, 3))) schema.textes.push({ x: +m[1], y: +m[2], texte: m[3].replace(/^[!;]/, '').replace(/\\n/g, '\n') });
  }
  return schema;
}

// Les propriétés KiCad imbriquent des listes et des chaînes échappées : lire
// les parenthèses évite de confondre les définitions avec les symboles placés.
function lireKicad(source) {
  let i = 0, nombre = 0;
  function espace() { while (i < source.length && /\s/.test(source[i])) i++; }
  function lire(profondeur = 0) {
    if (profondeur > 100 || ++nombre > 500000) throw Error('Schéma trop complexe pour cet aperçu.');
    espace();
    if (source[i] === '(') {
      i++; const liste = []; espace();
      while (i < source.length && source[i] !== ')') { liste.push(lire(profondeur + 1)); espace(); }
      if (source[i++] !== ')') throw Error('Schéma incomplet : parenthèse fermante manquante.');
      return liste;
    }
    if (source[i] === '"') {
      i++; let valeur = '';
      while (i < source.length) {
        const c = source[i++]; if (c === '"') return valeur;
        if (c === '\\') { const e = source[i++]; if (e === undefined) break; valeur += ({ n: '\n', r: '\r', t: '\t' })[e] || e; }
        else valeur += c;
      }
      throw Error('Schéma incomplet : guillemet fermant manquant.');
    }
    const debut = i; while (i < source.length && !/[\s()]/.test(source[i])) i++;
    if (i === debut) throw Error('Schéma invalide.');
    return source.slice(debut, i);
  }
  const racine = lire(); espace();
  if (i !== source.length || !Array.isArray(racine) || racine[0] !== 'kicad_sch') throw Error('Ce fichier n’est pas un schéma KiCad moderne.');
  const proprietes = liste => new Map(liste.filter(e => Array.isArray(e) && e[0] === 'property').map(e => [e[1], e[2] || '']));
  const composants = [], feuilles = [];
  for (const element of racine) if (Array.isArray(element)) {
    const p = proprietes(element);
    if (element[0] === 'symbol') composants.push({ reference: p.get('Reference') || '—', valeur: p.get('Value') || '', empreinte: p.get('Footprint') || '' });
    if (element[0] === 'sheet') feuilles.push({ nom: p.get('Sheetname') || p.get('Sheet name') || 'Sans nom', fichier: p.get('Sheetfile') || p.get('Sheet file') || '' });
  }
  return { composants, feuilles };
}

const PREFIXES_GEII = { p: 1e-12, n: 1e-9, 'µ': 1e-6, 'μ': 1e-6, u: 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9 };
// Dimensions dans la base Ω, s, A : F = s/Ω et V = Ω·A.
const UNITES_GEII = { 'Ω': [1, 0, 0], ohm: [1, 0, 0], F: [-1, 1, 0], s: [0, 1, 0], Hz: [0, -1, 0], A: [0, 0, 1], V: [1, 0, 1], H: [1, 1, 0], W: [1, 0, 2] };
const quantiteGeii = (valeur, dimension = [0, 0, 0]) => ({ valeur, dimension });
const memeDimensionGeii = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-10);
function uniteGeii(nom) {
  if (Object.hasOwn(UNITES_GEII, nom)) return quantiteGeii(1, UNITES_GEII[nom]);
  if (Object.hasOwn(PREFIXES_GEII, nom[0])) {
    const reste = nom.slice(1);
    if (!reste || Object.hasOwn(UNITES_GEII, reste)) return quantiteGeii(PREFIXES_GEII[nom[0]], UNITES_GEII[reste] || [0, 0, 0]);
  }
  return null;
}

function calculerExpressionGeii(source, variables = new Map()) {
  if (source.length > 2000) throw Error('Expression trop longue (2 000 caractères maximum).');
  let i = 0, token, profondeur = 0;
  const erreur = texte => { throw Error(`${texte} (colonne ${i + 1}).`); };
  function avancer() {
    while (i < source.length && /\s/.test(source[i])) i++;
    if (i === source.length) { token = { type: 'fin' }; return; }
    const reste = source.slice(i), n = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?/.exec(reste);
    if (n) { i += n[0].length; token = { type: 'nombre', valeur: +n[0].replace(',', '.') }; return; }
    const nom = /^[A-Za-z_µμΩ][A-Za-z0-9_µμΩ]*/.exec(reste);
    if (nom) { i += nom[0].length; token = { type: 'nom', valeur: nom[0] }; return; }
    if ('+-*/^()'.includes(source[i])) { token = { type: source[i++] }; return; }
    erreur('Caractère interdit');
  }
  function verifier(q) { if (!Number.isFinite(q.valeur) || !q.dimension.every(Number.isFinite)) erreur('Résultat non fini ou hors domaine'); return q; }
  function entrer(action) { if (++profondeur > 80) erreur('Expression trop imbriquée'); const r = action(); profondeur--; return r; }
  function primaire() {
    if (token.type === 'nombre') {
      let q = quantiteGeii(token.valeur); avancer();
      if (token.type === 'nom') { const u = uniteGeii(token.valeur); if (u) { q = quantiteGeii(q.valeur * u.valeur, u.dimension); avancer(); } }
      return verifier(q);
    }
    if (token.type === '(') { avancer(); const q = entrer(somme); if (token.type !== ')') erreur('Parenthèse fermante attendue'); avancer(); return q; }
    if (token.type === 'nom') {
      const nom = token.valeur; avancer();
      if (['sqrt', 'log10', 'ln', 'exp'].includes(nom)) {
        if (token.type !== '(') erreur(`Ajoute des parenthèses après ${nom}`);
        avancer(); const q = entrer(somme);
        if (token.type !== ')') erreur('Parenthèse fermante attendue'); avancer();
        if (nom === 'sqrt') return verifier(quantiteGeii(Math.sqrt(q.valeur), q.dimension.map(v => v / 2)));
        if (!memeDimensionGeii(q.dimension, [0, 0, 0])) erreur(`${nom} attend une valeur sans unité`);
        return verifier(quantiteGeii(({ log10: Math.log10, ln: Math.log, exp: Math.exp })[nom](q.valeur)));
      }
      if (nom === 'pi') return quantiteGeii(Math.PI);
      if (variables.has(nom)) return variables.get(nom);
      const u = uniteGeii(nom); if (u) return u;
      erreur(`Variable inconnue : ${nom}`);
    }
    erreur('Nombre, variable ou parenthèse attendu');
  }
  function puissance() {
    let a = primaire();
    if (token.type === '^') {
      avancer(); const b = entrer(unaire);
      if (!memeDimensionGeii(b.dimension, [0, 0, 0])) erreur('La puissance doit être sans unité');
      a = verifier(quantiteGeii(a.valeur ** b.valeur, a.dimension.map(v => v * b.valeur)));
    }
    return a;
  }
  function unaire() { if (token.type === '+' || token.type === '-') { const signe = token.type; avancer(); const q = entrer(unaire); return quantiteGeii(signe === '-' ? -q.valeur : q.valeur, q.dimension); } return puissance(); }
  function produit() {
    let a = unaire();
    while (token.type === '*' || token.type === '/') { const op = token.type; avancer(); const b = unaire(); a = verifier(quantiteGeii(op === '*' ? a.valeur * b.valeur : a.valeur / b.valeur, a.dimension.map((v, j) => v + (op === '*' ? 1 : -1) * b.dimension[j]))); }
    return a;
  }
  function somme() {
    let a = produit();
    while (token.type === '+' || token.type === '-') {
      const op = token.type; avancer(); const b = produit();
      if (!memeDimensionGeii(a.dimension, b.dimension)) erreur('Unités incompatibles pour cette addition ou soustraction');
      a = verifier(quantiteGeii(op === '+' ? a.valeur + b.valeur : a.valeur - b.valeur, a.dimension));
    }
    return a;
  }
  avancer(); const resultat = somme(); if (token.type !== 'fin') erreur('Opérateur attendu'); return verifier(resultat);
}

function notationIngenieurGeii(q) {
  if (typeof q === 'number') q = quantiteGeii(q);
  const unite = Object.entries(UNITES_GEII).find(([nom, dim]) => nom !== 'ohm' && memeDimensionGeii(dim, q.dimension))?.[0];
  const dimension = unite || (memeDimensionGeii(q.dimension, [0, 0, 0]) ? '' : ['Ω', 's', 'A'].map((nom, i) => q.dimension[i] ? `${nom}${q.dimension[i] === 1 ? '' : '^' + q.dimension[i]}` : '').filter(Boolean).join('·'));
  let exposant = q.valeur ? Math.floor(Math.log10(Math.abs(q.valeur)) / 3) * 3 : 0;
  if (exposant < -12 || exposant > 9) return `${q.valeur.toExponential(3).replace('.', ',')}${dimension ? ' ' + dimension : ''}`;
  let valeur = +(q.valeur / 10 ** exposant).toPrecision(4);
  if (Math.abs(valeur) >= 1000 && exposant < 9) { valeur /= 1000; exposant += 3; }
  const prefixe = ({ '-12': 'p', '-9': 'n', '-6': 'µ', '-3': 'm', 0: '', 3: 'k', 6: 'M', 9: 'G' })[exposant];
  // Un préfixe sur une unité composée serait ambigu : écrire alors ×10^n.
  const suffixe = unite || !dimension ? prefixe + dimension : `${exposant ? '×10^' + exposant + ' ' : ''}${dimension}`;
  return `${String(valeur).replace('.', ',')}${suffixe ? ' ' + suffixe : ''}`;
}

function calculerBlocGeii(source) {
  const variables = new Map(), lignes = [];
  for (const [i, ligne] of source.split(/\r?\n/).entries()) {
    if (!ligne.trim()) continue;
    if (i >= 1000) { lignes.push({ ligne: i + 1, nom: '', erreur: 'Limite de 1 000 lignes atteinte.' }); break; }
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(ligne);
    try {
      if (!m) throw Error('Écris nom = expression.');
      if (['pi', 'sqrt', 'log10', 'ln', 'exp'].includes(m[1]) || uniteGeii(m[1])) throw Error('Ce nom est réservé à une constante, une fonction ou une unité.');
      const q = calculerExpressionGeii(m[2], variables); variables.set(m[1], q);
      lignes.push({ ligne: i + 1, nom: m[1], ...q, resultat: notationIngenieurGeii(q) });
    } catch (e) { if (m) variables.delete(m[1]); lignes.push({ ligne: i + 1, nom: m?.[1] || '', erreur: e.message }); }
  }
  return lignes;
}

function tableauGeii(c, titres, lignes) {
  const table = c.createEl('div', { cls: 'cordee-geii-tableau' }).createEl('table');
  const entete = table.createEl('thead').createEl('tr'); titres.forEach(t => entete.createEl('th', { text: t, attr: { scope: 'col' } }));
  const corps = table.createEl('tbody');
  for (const ligne of lignes) { const tr = corps.createEl('tr'); ligne.forEach(t => tr.createEl('td', { text: String(t) })); }
}

function afficherAscGeii(c, source) {
  const schema = lireAsc(source), commandes = c.createEl('div', { cls: 'cordee-geii-commandes' });
  c.createEl('p', { cls: 'cordee-geii-aide', text: 'Aperçu simplifié en lecture seule : les rectangles représentent les composants, sans leurs broches exactes. Ouvre LTspice pour vérifier les connexions.' });
  const zone = c.createEl('div', { cls: 'cordee-geii-schema' });
  const creer = (tag, attrs = {}, texte) => {
    const el = zone.ownerDocument.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    if (texte !== undefined) el.textContent = texte;
    return el;
  };
  const svg = creer('svg', { role: 'img', 'aria-label': 'Schéma LTspice simplifié', preserveAspectRatio: 'xMinYMin meet' }); zone.appendChild(svg);
  const points = [], point = (x, y) => points.push([x, y]);
  const texte = (x, y, t) => { svg.appendChild(creer('text', { x, y, 'font-size': 14 }, t)); point(x, y - 16); point(x + Math.min(t.length, 300) * 9, y + 5); };
  for (const [x1, y1, x2, y2] of schema.fils) { svg.appendChild(creer('line', { x1, y1, x2, y2 })); point(x1, y1); point(x2, y2); }
  for (const n of schema.noeuds) {
    point(n.x - 12, n.y); point(n.x + 12, n.y + 24);
    if (n.nom === '0') svg.appendChild(creer('path', { d: `M${n.x} ${n.y}v8m-12 0h24m-19 5h14m-10 5h6` }));
    else { svg.appendChild(creer('circle', { cx: n.x, cy: n.y, r: 3 })); texte(n.x + 6, n.y - 8, n.nom); }
  }
  for (const s of schema.symboles) {
    const label = [s.nom || s.type, s.valeur].filter(Boolean).join(' '), largeur = Math.max(80, Math.min(label.length, 300) * 9 + 16);
    svg.appendChild(creer('rect', { x: s.x, y: s.y, width: largeur, height: 40, rx: 4 }));
    texte(s.x + 8, s.y + 25, label); point(s.x, s.y); point(s.x + largeur, s.y + 40);
  }
  for (const t of schema.textes) t.texte.split('\n').forEach((ligne, j) => texte(t.x, t.y + j * 18, ligne));
  if (!points.length) { c.createEl('p', { text: 'Aucun élément LTspice reconnu.' }); point(0, 0); point(200, 80); }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  svg.setAttribute('viewBox', `${minX - 24} ${minY - 24} ${Math.max(80, maxX - minX + 48)} ${Math.max(80, maxY - minY + 48)}`);
  // Taille naturelle par défaut (1 unité LTspice = 1 pixel), sans dépasser la largeur : étiré sur toute la
  // largeur, un petit circuit devenait énorme et débordait sur la suite de la note.
  const largeurNaturelle = Math.max(80, maxX - minX + 48);
  let zoom = 1, pleineLargeur = false;
  const ajuster = () => {
    svg.style.height = 'auto';
    svg.style.width = pleineLargeur ? '100%' : `${Math.round(largeurNaturelle * zoom)}px`;
    svg.style.maxWidth = pleineLargeur || zoom <= 1 ? '100%' : 'none';
  };
  boutonCordee(commandes, 'Réduire', () => { pleineLargeur = false; zoom = Math.max(0.25, zoom / 1.25); ajuster(); }, { cls: 'cordee-bouton-discret' });
  boutonCordee(commandes, 'Agrandir', () => { pleineLargeur = false; zoom = Math.min(8, zoom * 1.25); ajuster(); }, { cls: 'cordee-bouton-discret' });
  boutonCordee(commandes, 'Ajuster à la largeur', () => { pleineLargeur = true; ajuster(); }, { cls: 'cordee-bouton-discret' }); ajuster();
}

function afficherKicadGeii(c, source) {
  try {
    const { composants, feuilles } = lireKicad(source);
    c.createEl('p', { cls: 'cordee-geii-aide', text: 'Lecture seule : composants et feuilles de ce fichier. Les sous-feuilles restent dans leurs propres fichiers ; ouvre KiCad pour voir le schéma.' });
    tableauGeii(c, ['Référence', 'Valeur', 'Empreinte'], composants.map(s => [s.reference, s.valeur, s.empreinte || '—']));
    if (!composants.length) c.createEl('p', { text: 'Aucun composant placé dans cette feuille.' });
    c.createEl('h3', { text: 'Feuilles' });
    if (feuilles.length) tableauGeii(c, ['Nom', 'Fichier'], feuilles.map(f => [f.nom, f.fichier]));
    else c.createEl('p', { text: 'Aucune sous-feuille.' });
  } catch (e) { c.createEl('p', { text: e.message, attr: { role: 'status' } }); }
}

function enregistrerGeii(plugin) {
  if (plugin.registerMarkdownCodeBlockProcessor) {
    plugin.registerMarkdownCodeBlockProcessor('calc', (source, el) => {
      tableauGeii(el, ['Ligne', 'Nom', 'Résultat'], calculerBlocGeii(source).map(l => [l.ligne, l.nom, l.erreur ? 'Erreur : ' + l.erreur : l.resultat]));
    });
    plugin.registerMarkdownCodeBlockProcessor('ltspice', async (source, el, ctx) => {
      try {
        const lien = /^\s*\[\[([^\]\n]+)\]\]\s*$/.exec(source);
        if (lien) {
          const chemin = lien[1].split('|')[0];
          const fichier = plugin.app.metadataCache?.getFirstLinkpathDest(chemin, ctx.sourcePath);
          if (!fichier || fichier.extension?.toLowerCase() !== 'asc') throw Error('Fichier .asc introuvable : vérifie le chemin dans [[…]].');
          source = await plugin.app.vault.read(fichier);
        }
        afficherAscGeii(el, source);
      } catch (e) { el.createEl('p', { text: e.message, attr: { role: 'status' } }); }
    });
  }
  if (!O?.TextFileView || !plugin.registerView || !plugin.registerExtensions) return;
  for (const [type, extensions, logiciel] of [
    ['code', ['ino', 'c', 'h', 'm', 'py', 'vhd', 'asm', 's'], 'le logiciel'],
    ['ltspice', ['asc'], 'LTspice'], ['kicad', ['kicad_sch'], 'KiCad'],
  ]) {
    const id = 'cordee-geii-' + type;
    const acceptees = new Set();
    class VueGeii extends O.TextFileView {
      constructor(leaf) {
        super(leaf); this.texteGeii = ''; this.contentEl.empty(); this.contentEl.addClass('cordee-geii-vue');
        const barre = this.contentEl.createEl('div', { cls: 'cordee-geii-commandes' });
        boutonCordee(barre, 'Ouvrir dans ' + logiciel, async () => {
          try {
            if (!this.file || typeof this.app.openWithDefaultApp !== 'function') throw Error('L’ouverture externe n’est pas disponible sur cet appareil.');
            if (type === 'code') await this.save();
            await this.app.openWithDefaultApp(this.file.path);
          } catch (e) { new O.Notice(e.message || 'Impossible d’ouvrir ce fichier dans le logiciel.'); }
        }, { cls: 'cordee-bouton-discret' });
        this.zoneGeii = this.contentEl.createEl('div', { cls: 'cordee-geii-contenu' });
        if (type === 'code') {
          const editeur = this.zoneGeii.createEl('div', { cls: 'cordee-geii-editeur' });
          this.numerosGeii = editeur.createEl('pre', { cls: 'cordee-geii-numeros', attr: { 'aria-hidden': 'true' } });
          this.champGeii = editeur.createEl('textarea', { cls: 'cordee-geii-code', attr: { 'aria-label': 'Code source', wrap: 'off', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off' } });
          this.champGeii.oninput = () => { this.actualiserNumeros(); this.requestSave(); };
          this.champGeii.onscroll = () => { this.numerosGeii.scrollTop = this.champGeii.scrollTop; };
        }
      }
      getViewType() { return id; }
      canAcceptExtension(extension) { return acceptees.has(extension.toLowerCase()); }
      getDisplayText() { return this.file?.name || (type === 'code' ? 'Code GEII' : logiciel); }
      getViewData() { return this.champGeii ? this.champGeii.value : this.texteGeii; }
      setViewData(data, clear) {
        this.texteGeii = data;
        if (this.champGeii) { this.champGeii.value = data; this.actualiserNumeros(); if (clear) this.champGeii.scrollTop = this.champGeii.scrollLeft = 0; }
        else { this.zoneGeii.empty(); (type === 'ltspice' ? afficherAscGeii : afficherKicadGeii)(this.zoneGeii, data); }
      }
      actualiserNumeros() { this.numerosGeii.setText(Array.from({ length: this.champGeii.value.split('\n').length }, (_, i) => i + 1).join('\n')); this.numerosGeii.scrollTop = this.champGeii.scrollTop; }
      clear() { this.texteGeii = ''; if (this.champGeii) { this.champGeii.value = ''; this.actualiserNumeros(); } else this.zoneGeii.empty(); }
      // TextFileView sauvegarde aussi à la fermeture. Un aperçu ne doit jamais
      // écraser les changements que LTspice ou KiCad viennent d'enregistrer.
      async save(clear) { if (type === 'code') return super.save(clear); }
    }
    plugin.registerView(id, leaf => new VueGeii(leaf));
    for (const extension of extensions) {
      try { plugin.registerExtensions([extension], id); acceptees.add(extension); }
      catch { /* Une extension déjà prise reste gérée par son module actuel. */ }
    }
  }
}

/* ---------- Moodle ---------- */

const TAILLE_MAX_MOODLE = 50 * 1024 * 1024;
const TAILLE_MAX_IMAGE_MOODLE = 5 * 1024 * 1024;
const DELAI_MOODLE = 6 * 3600_000;
const AIDE_JETON_MOODLE = 'Ton Moodle utilise peut-être la connexion de l’université : choisis « Se connecter via le navigateur ». Si tu disposes déjà d’une clé « Moodle mobile web service » dans Préférences → Clés de sécurité, tu peux aussi la coller. La clé RSS ne convient pas.';

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
    // Une adresse copiée depuis la connexion reste utilisable, même pour un Moodle en sous-dossier.
    const chemin = u.pathname.replace(/\/+$/, '').replace(/\/(?:login\/)?index\.php$/, '');
    return u.origin + chemin;
  } catch { throw new Error('Indique l’adresse HTTPS de ton Moodle, par exemple https://moodle.exemple.fr.'); }
}

function copieMoodle(chemin, numero = 1) {
  const point = chemin.lastIndexOf('.'), slash = chemin.lastIndexOf('/');
  const suffixe = numero === 1 ? ' (Moodle)' : ` (Moodle ${numero})`;
  return point > slash ? chemin.slice(0, point) + suffixe + chemin.slice(point) : chemin + suffixe;
}

function lienConnexionMoodle(site) {
  const url = new URL(siteMoodle(site) + '/admin/tool/mobile/launch.php');
  const passport = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
  url.search = new URLSearchParams({ service: 'moodle_mobile_app', passport, urlscheme: 'cordee-moodle', confirmed: '1' }).toString();
  return url.href;
}

function jetonDepuisLienMoodle(valeur) {
  const texte = String(valeur || '').trim();
  if (!texte.includes('://')) return texte;
  try {
    // Le lien est collé volontairement dans Cordée, jamais ouvert ni envoyé à un autre site.
    const lien = /^(?:cordee-moodle|moodlemobile):\/\/token=([^\s]+)$/.exec(texte);
    if (!lien || lien[1].length > 4096) throw new Error();
    const base64 = decodeURIComponent(lien[1]);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error();
    const parties = atob(base64).split(':::');
    // Moodle peut ajouter une clé privée alphanumérique de 64 caractères.
    // Seuls l’identifiant du site et le jeton utilisé par Cordée sont hexadécimaux.
    if (parties.length < 2 || parties.length > 3 || parties.slice(0, 2).some((p) => !/^[a-f0-9]{32}$/i.test(p))) throw new Error();
    return parties[1]; // La troisième partie, clé privée de l’app mobile, n’est jamais conservée.
  } catch { throw new Error('Copie l’adresse complète du lien « lancer l’application » sur la page Moodle, puis colle-la ici.'); }
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

function imageCoursMoodle(cours, destination) {
  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
  const candidats = [...(cours.overviewfiles || [])];
  if (cours.courseimage) candidats.push({ fileurl: cours.courseimage, timemodified: cours.timemodified });
  for (const f of candidats) {
    let url;
    try { url = new URL(f.fileurl); } catch { continue; }
    const ext = extensions[f.mimetype] || /\.(png|jpe?g|gif|webp)$/i.exec(url.pathname)?.[1]?.toLowerCase();
    const taille = Number(f.filesize || 0), modifie = Number(f.timemodified || 0);
    if (!ext || !Number.isFinite(taille) || taille < 0 || taille > TAILLE_MAX_IMAGE_MOODLE || !Number.isFinite(modifie)) continue;
    // L’API peut renvoyer l’adresse web de la couverture plutôt que celle du service mobile.
    if (!url.pathname.includes('/webservice/pluginfile.php/')) url.pathname = url.pathname.replace('/pluginfile.php/', '/webservice/pluginfile.php/');
    const filename = 'Couverture.' + (ext === 'jpeg' ? 'jpg' : ext);
    return { cle: JSON.stringify([cours.id, 'couverture']), chemin: dossierMoodle(destination) + '/_Médias/' + filename,
      filename, fileurl: url.href, filesize: taille, timemodified: modifie };
  }
  return null;
}

function typeImageMoodle(buf) {
  const b = new Uint8Array(buf), ascii = (de, a) => String.fromCharCode(...b.slice(de, a));
  if (b.length > TAILLE_MAX_IMAGE_MOODLE) return null;
  if (b.length >= 8 && b[0] === 137 && ascii(1, 4) === 'PNG' && b[4] === 13 && b[5] === 10 && b[6] === 26 && b[7] === 10) return 'image/png';
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function indexMoodle(cours, sections, fichiers, cache, couverture = null) {
  const lignes = [`# ${nomMoodle(cours.fullname || cours.shortname)}`, ''];
  const image = couverture && cache[couverture.cle];
  if (image && image.source === couverture.chemin) lignes.push(`![[${image.chemin}|640]]`, '');
  if (cours.summary) lignes.push(markdownMoodle(cours.summary), '');
  lignes.push('Fichiers récupérés depuis Moodle. Ce dossier est partagé avec la cordée sauf s’il figure dans « Dossiers non partagés ».', '');
  const titres = new Set(fichiers.map((f) => f.section));
  for (const section of sections || []) titres.add(nomMoodle(section.name, 'Général'));
  for (const titre of titres) {
    lignes.push(`## ${titre}`, '');
    const presents = fichiers.filter((f) => f.section === titre);
    for (const f of presents) {
      const recu = cache[f.cle];
      lignes.push(recu && recu.source === f.chemin ? `- [[${recu.chemin}|${f.filename}]]` : `- ${f.filename} — ${f.filesize > TAILLE_MAX_MOODLE ? 'dépasse 50 Mo' : 'pas encore récupéré'}`);
      if (recu && recu.source === f.chemin && /\.(png|jpe?g|gif|webp)$/i.test(f.filename)) lignes.push('', `![[${recu.chemin}|640]]`, '');
    }
    if (!presents.length) lignes.push('Aucun fichier de ressource ou de dossier.');
    lignes.push('');
  }
  return lignes.join('\n');
}

function erreurMoodle(code) {
  // Messages locaux : ne jamais afficher le texte réseau, qui peut contenir le jeton.
  const messages = new Map([
    ['invalidtoken', 'Ton jeton Moodle est invalide ou expiré (invalidtoken). Dans Préférences → Clés de sécurité, copie la clé du service « Moodle mobile web service », pas la clé RSS.'],
    ['invalidtimedtoken', 'Ton jeton Moodle a expiré (invalidtimedtoken). Renouvelle la clé du service mobile dans Préférences → Clés de sécurité.'],
    ['invalidiptoken', 'Moodle refuse ce jeton depuis ta connexion réseau (invalidiptoken). Une restriction réseau doit être vérifiée par l’administrateur Moodle.'],
    ['accessexception', 'Moodle refuse l’accès à cette fonction (accessexception). Vérifie le service associé au jeton ; les autorisations peuvent nécessiter l’intervention de l’administrateur Moodle.'],
    ['webservice_access_exception', 'Moodle refuse l’accès au service (webservice_access_exception). Les autorisations de ton compte ou du service doivent être vérifiées.'],
    ['servicenotavailable', 'Le service demandé est indisponible ou désactivé sur Moodle (servicenotavailable).'],
    ['requireloginerror', 'Moodle exige une connexion pour cette demande (requireloginerror). Vérifie que le jeton correspond au service mobile.'],
    ['http401', 'Le serveur refuse la demande (HTTP 401). Cela ne suffit pas à conclure que ton jeton est invalide.'],
    ['http403', 'Le serveur interdit l’accès (HTTP 403). Cela ne suffit pas à conclure que ton jeton est invalide.'],
  ]);
  const message = messages.get(code) || 'Moodle refuse cette demande. Vérifie que les services de l’application mobile sont activés pour ton compte.';
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
    if ([401, 403].includes(r.status)) throw erreurMoodle('http' + r.status);
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
    const acces = { site: siteMoodle(site), jeton: jetonDepuisLienMoodle(jeton) };
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
  async telechargerImageMoodle(fichier, acces) {
    const buf = await this.telechargerMoodle(fichier, acces);
    const type = typeImageMoodle(buf);
    if (!type) throw new Error('Cette couverture n’est pas une image PNG, JPEG, GIF ou WebP de moins de 5 Mo.');
    return { buf, type };
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
        if (this.arret || m !== this.etat.moodle) throw new Error('La récupération Moodle a été arrêtée.');
        const fichiers = fichiersMoodle(sections, destination, coursActuel.id).filter((f) => !m.fichiers[f.cle]?.ignorer);
        const couverture = imageCoursMoodle(coursActuel, destination);
        if (couverture) {
          try {
            const avant = m.fichiers[couverture.cle];
            if (doitTelechargerMoodle(couverture, avant, !!(avant && this.trouverMoodle(avant.chemin)))) {
              const { buf } = await this.telechargerImageMoodle(couverture, m);
              const recu = await this.ecrireMoodle(couverture.chemin, buf, avant, m);
              m.fichiers[couverture.cle] = { ...recu, timemodified: couverture.timemodified, filesize: couverture.filesize };
              await this.saveData(this.etat);
            }
          } catch { avertissements.push(`La couverture de ${nomMoodle(coursActuel.shortname || coursActuel.fullname)} n’a pas pu être récupérée.`); }
        }
        if (this.arret || m !== this.etat.moodle) throw new Error('La récupération Moodle a été arrêtée.');
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
        const note = versBuffer(indexMoodle(coursActuel, sections, fichiers, m.fichiers, couverture));
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

/** Section repliable des réglages ; son état ouvert/fermé est gardé le temps de la session. */
function sectionRepliable(c, titre, cle, hote) {
  const ouverts = hote.sectionsOuvertes || (hote.sectionsOuvertes = new Set());
  const d = c.createEl('details', { cls: 'cordee-section' });
  d.open = ouverts.has(cle);
  d.createEl('summary', { text: titre });
  d.addEventListener?.('toggle', () => { if (d.open) ouverts.add(cle); else ouverts.delete(cle); });
  return d.createEl('div', { cls: 'cordee-section-corps' });
}

function afficherReglagesMoodle(c, p) {
  const zone = c.createEl('div', { cls: 'cordee-moodle' });
  zone.createEl('p', { text: 'Récupère tes cours dans le coffre ; ton jeton reste sur cet appareil.', cls: 'cordee-details' });
  const retour = zone.createEl('p', { cls: 'cordee-details', attr: { role: 'status', 'aria-live': 'polite' } });
  let adresse = p.etat.moodle.site, identifiant = '', jeton, motDePasse;
  new O.Setting(zone).setName('Adresse du site Moodle').setDesc('Le site ou sa page de connexion.').addText((t) => t.setPlaceholder('https://moodle.exemple.fr').setValue(adresse).onChange((v) => { adresse = v; }));
  new O.Setting(zone).setName('Connexion universitaire').addButton((b) => {
    if (!p.etat.moodle.jeton) b.setCta();
    b.setButtonText('Se connecter via le navigateur').onClick(() => {
      try { new ConnexionMoodleModal(p.app, p, siteMoodle(adresse)).open(); }
      catch (e) { retour.setText(e.message); }
    });
  });
  const connexion = zone.createEl('details', { cls: 'cordee-section' });
  connexion.createEl('summary', { text: 'Autres méthodes de connexion' });
  new O.Setting(connexion).setName('Identifiant Moodle').setDesc('Facultatif avec un jeton.').addText((t) => t.onChange((v) => { identifiant = v; }));
  new O.Setting(connexion).setName('Mot de passe Moodle').setDesc('Jamais enregistré.').addText((t) => { motDePasse = t; t.inputEl.type = 'password'; t.inputEl.autocomplete = 'off'; });
  new O.Setting(connexion).setName('Jeton Moodle').setDesc('Clés de sécurité → « Moodle mobile web service », pas la clé RSS.').addText((t) => { jeton = t; t.inputEl.type = 'password'; t.inputEl.autocomplete = 'off'; t.setPlaceholder(p.etat.moodle.jeton ? 'Jeton enregistré sur cet appareil' : 'Coller un jeton'); });
  new O.Setting(connexion).addButton((b) => b.setButtonText('Tester').onClick(async () => {
    b.setDisabled(true);
    const secret = motDePasse.inputEl.value || '', cle = jeton.inputEl.value || '';
    motDePasse.setValue(''); jeton.setValue('');
    try { const resultat = await p.connecterMoodle(adresse, cle, identifiant, secret); retour.setText(`Connecté en tant que ${resultat.prenom} · ${resultat.cours.length} cours`); }
    catch (e) { retour.setText(e.message); }
    finally { b.setDisabled(false); }
  }));
  new O.Setting(zone).addButton((b) => {
    if (p.etat.moodle.jeton) b.setCta();
    b.setButtonText('Cours Moodle').onClick(() => new CoursMoodleModal(p.app, p).open());
  }).addButton((b) => b.setButtonText('Mes notes Moodle').onClick(() => new NotesMoodleModal(p.app, p).open()));
  const compte = zone.createEl('details', { cls: 'cordee-section' });
  compte.createEl('summary', { text: 'Compte Moodle' });
  new O.Setting(compte).addButton((b) => b.setButtonText('Se déconnecter de Moodle').onClick(async () => { await p.deconnecterMoodle(); motDePasse.setValue(''); jeton.setValue(''); retour.setText('Déconnecté ; les fichiers récupérés restent dans le coffre.'); }));
}

let ConnexionMoodleModal;
if (O) ConnexionMoodleModal = class extends O.Modal {
  constructor(app, plugin, site) { super(app); this.plugin = plugin; this.site = site; }
  onOpen() {
    preparerPageSecondaire(this);
    const c = this.contentEl, p = this.plugin;
    this.accesInitial = p.etat.moodle;
    c.empty(); c.createEl('h2', { text: 'Connexion Moodle par le navigateur' });
    c.createEl('p', { text: '1. Ouvre Moodle et connecte-toi sur le site de ton université.' });
    c.createEl('a', { text: 'Ouvrir la connexion Moodle', cls: 'external-link', attr: { href: lienConnexionMoodle(this.site), target: '_blank', rel: 'noopener noreferrer' } });
    c.createEl('p', { text: '2. Copie l’adresse du lien proposé pour lancer l’application (clic droit ou appui long).' });
    c.createEl('p', { text: '3. Colle ce lien privé ici pour terminer.' });
    const aide = c.createEl('details', { cls: 'cordee-section' });
    aide.createEl('summary', { text: 'Le lien ne s’ouvre pas ?' });
    aide.createEl('p', { text: 'Ferme le message du navigateur, puis copie l’adresse du lien Moodle ; la clé RSS ne convient pas.', cls: 'cordee-details' });
    let champ;
    new O.Setting(c).setName('Lien de retour Moodle').addText((t) => { champ = t; t.inputEl.type = 'password'; t.inputEl.autocomplete = 'off'; t.setPlaceholder('cordee-moodle://token=…'); });
    this.champ = champ;
    const retour = c.createEl('p', { cls: 'cordee-details', attr: { role: 'status', 'aria-live': 'polite' } });
    new O.Setting(c).addButton((b) => b.setButtonText('Terminer la connexion').setCta().onClick(async () => {
      if (this.ferme) return;
      if (this.accesInitial !== p.etat.moodle) { retour.setText('Le compte Moodle a changé. Ferme cette fenêtre et recommence la connexion.'); return; }
      b.setDisabled(true);
      const lien = champ.inputEl.value || ''; champ.setValue('');
      try {
        const jeton = jetonDepuisLienMoodle(lien);
        if (!jeton || !lien.includes('://')) throw new Error('Colle le lien de retour fourni par Moodle après ta connexion.');
        const resultat = await p.connecterMoodle(this.site, jeton);
        if (this.ferme) return;
        this.accesInitial = p.etat.moodle;
        retour.setText(`Connecté en tant que ${resultat.prenom} · ${resultat.cours.length} cours`);
        new O.Notice('Connexion Moodle enregistrée. Tu peux ouvrir « Cours Moodle ».');
      } catch (e) { if (!this.ferme) retour.setText(e.message); }
      finally { b.setDisabled(false); }
    }));
  }
  onClose() { this.ferme = true; this.champ?.setValue(''); this.contentEl.empty(); }
};

let CoursMoodleModal;
if (O) CoursMoodleModal = class extends O.Modal {
  constructor(app, plugin) { super(app); this.plugin = plugin; }
  async onOpen() {
    preparerPageSecondaire(this);
    const c = this.contentEl, p = this.plugin, m = p.etat.moodle;
    this.objetsImages = [];
    this.modalEl?.addClass('cordee-moodle-modal');
    const destinationsInvalides = new Set();
    c.empty(); c.createEl('h2', { text: 'Cours Moodle' });
    c.createEl('p', { text: 'Retrouve tes cours et choisis ceux à garder dans ton coffre.', cls: 'cordee-details' });
    const aide = c.createEl('details', { cls: 'cordee-moodle-aide' });
    aide.createEl('summary', { text: 'Récupération et partage' });
    aide.createEl('p', { text: 'Chaque cours sélectionné est partagé avec la cordée, sauf dans « Dossiers non partagés » ; tes rendus et notes restent privés.', cls: 'cordee-details' });
    aide.createEl('p', { text: 'Les fichiers, couvertures et annonces sont actualisés toutes les 6 h quand Obsidian est ouvert.', cls: 'cordee-details' });
    const retour = c.createEl('p', { text: 'Chargement des cours…', attr: { role: 'status', 'aria-live': 'polite' } });
    try {
      const cours = await p.coursMoodle();
      if (this.ferme || m !== p.etat.moodle) return;
      retour.setText(cours.length ? '' : 'Tu n’as aucun cours Moodle pour le moment.');
      const noms = cours.map((v) => nomMoodle(v.shortname || v.fullname));
      const cartes = [], apercus = [];
      const compteur = c.createEl('p', { cls: 'cordee-moodle-compteur', attr: { role: 'status', 'aria-live': 'polite' } });
      const normaliser = (texte) => texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      let recherche = '';
      const filtrer = () => {
        let visibles = 0;
        for (const carte of cartes) { carte.bloc.hidden = !carte.recherche.includes(recherche); if (!carte.bloc.hidden) visibles++; }
        const selectionnes = cours.filter((v) => m.selections[v.id]?.copier).length;
        compteur.setText(`${visibles} cours · ${selectionnes} ${selectionnes === 1 ? 'sélectionné' : 'sélectionnés'}`);
      };
      new O.Setting(c).setName('Rechercher un cours').addText((t) => t.setPlaceholder('Nom, matière…').onChange((v) => { recherche = normaliser(v.trim()); filtrer(); }));
      const grille = c.createEl('div', { cls: 'cordee-moodle-grille' });
      for (const coursActuel of cours) {
        const nom = nomMoodle(coursActuel.shortname || coursActuel.fullname);
        const defaut = 'Moodle/' + nom + (noms.filter((v) => v.toLowerCase() === nom.toLowerCase()).length > 1 ? ` (${nomMoodle(coursActuel.id)})` : '');
        const choix = m.selections[coursActuel.id] || (m.selections[coursActuel.id] = { copier: false, dossier: defaut });
        const bloc = grille.createEl('article', { cls: 'cordee-moodle-carte' });
        const visuel = bloc.createEl('div', { cls: 'cordee-moodle-visuel' });
        const repli = visuel.createEl('span', { text: nom.slice(0, 3).toUpperCase(), cls: 'cordee-moodle-repli', attr: { 'aria-hidden': 'true' } });
        const couverture = imageCoursMoodle(coursActuel, choix.dossier);
        if (couverture) apercus.push({ couverture, visuel, repli });
        const contenu = bloc.createEl('div', { cls: 'cordee-moodle-carte-contenu' });
        contenu.createEl('span', { text: nom, cls: 'cordee-moodle-code' });
        contenu.createEl('h3', { text: texteMoodle(coursActuel.fullname || coursActuel.shortname) });
        const description = texteMoodle(coursActuel.summary || '').replace(/\s+/g, ' ').trim();
        if (description) {
          const presentation = contenu.createEl('details', { cls: 'cordee-moodle-presentation' });
          presentation.createEl('summary', { text: 'Présentation' });
          presentation.createEl('p', { text: description, cls: 'cordee-moodle-description' });
        }
        const label = contenu.createEl('label', { cls: 'cordee-moodle-selection' });
        const caseCopier = label.createEl('input', { attr: { type: 'checkbox', 'aria-label': `Copier dans le coffre : ${nom}` } });
        caseCopier.checked = !!choix.copier;
        label.createEl('span', { text: ' Copier dans le coffre' });
        bloc.setAttribute('data-selectionne', String(!!choix.copier));
        caseCopier.onchange = async () => { if (m !== p.etat.moodle) return; choix.copier = caseCopier.checked; bloc.setAttribute('data-selectionne', String(choix.copier)); filtrer(); await p.saveData(p.etat); };
        const details = contenu.createEl('details', { cls: 'cordee-moodle-destination' });
        details.createEl('summary', { text: 'Dossier de destination' });
        new O.Setting(details).setName(`Dossier de destination · ${nom}`).addText((t) => t.setValue(choix.dossier).onChange(async (v) => {
          try {
            const dossier = dossierMoodle(v);
            if (dansConfiguration(dossier, p.app.vault.configDir)) throw new Error('Choisis un dossier en dehors de la configuration d’Obsidian.');
            if (m !== p.etat.moodle) return;
            choix.dossier = dossier; destinationsInvalides.delete(coursActuel.id); await p.saveData(p.etat); retour.setText(`Destination : ${dossier}`);
          } catch (e) { destinationsInvalides.add(coursActuel.id); retour.setText(e.message); }
        }));
        let ouvrir;
        new O.Setting(contenu).addButton((b) => { ouvrir = b; b.setButtonText('Ouvrir le cours').onClick(() => {
          if (m !== p.etat.moodle) return;
          const chemin = m.index[coursActuel.id]?.chemin;
          if (chemin && p.trouverMoodle(chemin)) p.app.workspace.openLinkText(chemin, '');
        }); });
        cartes.push({ bloc, recherche: normaliser(`${nom} ${texteMoodle(coursActuel.fullname || '')} ${description}`), ouvrir, id: coursActuel.id });
      }
      const actualiserCartes = () => {
        for (const carte of cartes) {
          const chemin = m.index[carte.id]?.chemin;
          carte.ouvrir.setDisabled(!(chemin && p.trouverMoodle(chemin)));
        }
        filtrer();
      };
      actualiserCartes();
      const actions = c.createEl('div', { cls: 'cordee-moodle-actions' });
      // L’action reste visible avant une longue liste de cours, sans recouvrir les cartes.
      c.insertBefore(actions, grille);
      boutonCordee(actions, 'Récupérer maintenant', async () => {
        if (m !== p.etat.moodle) { retour.setText('Rouvre les cours après ta reconnexion à Moodle.'); return; }
        if ([...destinationsInvalides].some((id) => m.selections[id]?.copier)) { retour.setText('Corrige le dossier de destination avant de récupérer les fichiers.'); return; }
        retour.setText('Récupération en cours…');
        try { const n = await p.recupererMoodle(); if (this.ferme || m !== p.etat.moodle) return; actualiserCartes(); retour.setText((n ? `${n} fichier(s) récupéré(s).` : 'Tes fichiers Moodle sont à jour.') + ' ' + (m.avertissements || []).join(' ')); }
        catch (e) { retour.setText(e.message); }
      }, { cls: 'cordee-bouton-principal' });
      // Trois téléchargements au plus ; aucune adresse contenant le jeton n’entre dans le DOM.
      let prochain = 0;
      await Promise.all(Array.from({ length: Math.min(3, apercus.length) }, async () => {
        while (prochain < apercus.length && !this.ferme && m === p.etat.moodle) {
          const { couverture, visuel, repli } = apercus[prochain++];
          try {
            const avant = m.fichiers[couverture.cle], local = avant && p.trouverMoodle(avant.chemin);
            let buf, type;
            if (local instanceof O.TFile && !doitTelechargerMoodle(couverture, avant)) {
              buf = await p.app.vault.readBinary(local); type = typeImageMoodle(buf);
            }
            if (!type) ({ buf, type } = await p.telechargerImageMoodle(couverture, m));
            if (this.ferme || m !== p.etat.moodle) return;
            const url = URL.createObjectURL(new Blob([buf], { type }));
            this.objetsImages.push(url);
            const image = visuel.createEl('img', { attr: { src: url, alt: '', loading: 'lazy' } });
            repli.hidden = true;
            image.onerror = () => { image.hidden = true; repli.hidden = false; };
          } catch { /* Un visuel indisponible laisse le nom du cours visible. */ }
        }
      }));
    } catch (e) { retour.setText(e.message + ' Ouvre Réglages → Cordée → Moodle pour te connecter.'); }
  }
  onClose() { this.ferme = true; for (const url of this.objetsImages || []) URL.revokeObjectURL(url); this.objetsImages = []; this.contentEl.empty(); }
};

let NotesMoodleModal;
if (O) NotesMoodleModal = class extends O.Modal {
  constructor(app, plugin) { super(app); this.plugin = plugin; }
  async onOpen() {
    preparerPageSecondaire(this);
    const c = this.contentEl, p = this.plugin, acces = p.etat.moodle;
    if (p.modalNotesMoodle && p.modalNotesMoodle !== this) p.modalNotesMoodle.onClose();
    p.modalNotesMoodle = this;
    c.empty(); c.createEl('h2', { text: 'Mes notes Moodle' });
    c.createEl('p', { text: 'Tes notes restent dans cette fenêtre, sans enregistrement ni partage.', cls: 'cordee-details' });
    const retour = c.createEl('p', { text: 'Chargement des notes…', attr: { role: 'status', 'aria-live': 'polite' } });
    try {
      const cours = await p.coursMoodle();
      for (const coursActuel of cours) {
        if (this.ferme || acces !== p.etat.moodle) return;
        const notes = await p.notesMoodle(coursActuel.id, acces);
        if (this.ferme || acces !== p.etat.moodle) return;
        const bloc = c.createEl('details', { cls: 'cordee-moodle-cours cordee-section' });
        bloc.open = cours.length <= 3 || coursActuel === cours[0];
        bloc.createEl('summary', { text: coursActuel.shortname || coursActuel.fullname });
        if (!notes.length) bloc.createEl('p', { text: 'Pas encore de note visible dans ce cours.' });
        for (const note of notes) bloc.createEl('p', { text: `${note.titre} · ${note.note}${note.bareme ? ' · ' + note.bareme : ''}` });
      }
      if (!this.ferme && acces === p.etat.moodle) retour.setText(cours.length ? '' : 'Tu n’as aucun cours Moodle pour le moment.');
      if (!this.ferme && acces === p.etat.moodle) boutonCordee(c, 'Fermer', () => this.close(), { cls: 'cordee-bouton-principal' });
    } catch (e) { if (!this.ferme && acces === p.etat.moodle) retour.setText(e.message); }
  }
  onClose() { this.ferme = true; this.contentEl.empty(); if (this.plugin.modalNotesMoodle === this) this.plugin.modalNotesMoodle = null; }
};

/* ---------- Fin Moodle ---------- */

module.exports = CordeePlugin;
module.exports.default = CordeePlugin;
module.exports.interne = { lireCalendriersPartages, modifierCalendriersPartages, get HistoriqueModal() { return HistoriqueModal; }, get CreneauModal() { return CreneauModal; }, get dessinerSemaine() { return dessinerSemaine; }, lireIcs, developper, lireAgendaPartage, ligneAgenda, typeCalendrier, masquerUrl, debutSemaine, placerEnColonnes, get RevisionModal() { return RevisionModal; }, VERSION, comparerVersions, lignesModifiees, couleurAuteur, ilYa, arriveesPresence, derniereActivite, resumePresence, afficherBarrePresence, echapperCss, fusionner, Moteur, empreinte, versBuffer, versTexte, nomCopieConflit, lireInvitation, expliquerErreur, avatarValide, preparerPhoto, calculerDiff, premierBlocModifie };
Object.assign(module.exports.interne, { lireAsc, lireKicad, calculerExpressionGeii, calculerBlocGeii, notationIngenieurGeii, estTexte });
Object.assign(module.exports.interne, { nomMoodle, dossierMoodle, siteMoodle, lienConnexionMoodle, jetonDepuisLienMoodle, fichiersMoodle, imageCoursMoodle, typeImageMoodle, doitTelechargerMoodle, modificationLocaleMoodle, copieMoodle, indexMoodle, get CoursMoodleModal() { return CoursMoodleModal; } });
Object.assign(module.exports.interne, { markdownMoodle, devoirMoodle, noteAnnoncesMoodle, get NotesMoodleModal() { return NotesMoodleModal; } });
Object.assign(module.exports.interne, { ecouterRevisions });
