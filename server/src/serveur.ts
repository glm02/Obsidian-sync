// Serveur Cordée : partage de coffres Obsidian entre amis.
// Il ne fait que stocker des versions de fichiers et refuser les écritures faites sur une version périmée.
// Les fusions se font côté extension, qui connaît la version de base, la sienne et celle du serveur.
// Aucune dépendance : Node 22 apporte SQLite, le hachage et HTTP.

import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export interface Options {
  dossierDonnees: string;
  codeCreation: string;
  tailleMaxOctets?: number;
  urlPublique?: string;
  // Derrière un proxy (Caddy), toutes les requêtes arrivent de la même adresse : le limiteur
  // d'essais deviendrait commun à tout le monde, et un inconnu pourrait bloquer les autres.
  // Activé, on lit X-Real-IP, que le proxy doit écraser (jamais compléter) à chaque requête.
  derriereProxy?: boolean;
  // Page d'invitation hébergée ailleurs (ex. le site de présentation sur Vercel). Le lien devient
  // <page>#serveur=…&code=… : la page explique comment rejoindre, et ne reçoit jamais le code.
  pageInvitation?: string;
}

class ErreurHttp extends Error {
  statut: number;
  constructor(statut: number, message: string) {
    super(message);
    this.statut = statut;
  }
}

const sha256 = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const maintenant = () => Date.now();
const identifiant = (n = 16) => randomBytes(n).toString('base64url');
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O, 1/I/L : se lit et se dicte sans erreur
const HASH_VALIDE = /^[a-f0-9]{64}$/;
const TAILLE_MAX_AVATAR = 32 * 1024;
const TAILLE_MAX_COMPARAISON = 256 * 1024;

interface ChangementStocke {
  rev: number; chemin: string; hash: string | null; supprime: number; le: number;
  auteurId: string; auteur: string | null; type: 'fichier' | 'dossier'; avantHash: string | null;
}

function avatarValide(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v !== 'string') throw new ErreurHttp(400, 'Choisis une photo PNG, JPEG ou WebP, ou retire-la avec null.');
  const image = v.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!image) throw new ErreurHttp(400, 'La photo doit être une image PNG, JPEG ou WebP encodée en base64.');
  if (image[2].length > Math.ceil(TAILLE_MAX_AVATAR / 3) * 4) throw new ErreurHttp(413, 'La photo doit peser au plus 32 Ko.');
  const octets = Buffer.from(image[2], 'base64');
  if (octets.length > TAILLE_MAX_AVATAR) throw new ErreurHttp(413, 'La photo doit peser au plus 32 Ko.');
  if (octets.toString('base64') !== image[2]) throw new ErreurHttp(400, 'Encodage base64 de la photo invalide.');
  const png = octets.length >= 24 && octets.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && octets.toString('ascii', 12, 16) === 'IHDR';
  const jpeg = octets.length >= 4 && octets[0] === 255 && octets[1] === 216 && octets[2] === 255
    && octets[octets.length - 2] === 255 && octets[octets.length - 1] === 217;
  const webp = octets.length >= 20 && octets.toString('ascii', 0, 4) === 'RIFF'
    && octets.readUInt32LE(4) === octets.length - 8 && octets.toString('ascii', 8, 12) === 'WEBP'
    && ['VP8 ', 'VP8L', 'VP8X'].includes(octets.toString('ascii', 12, 16));
  if (!(image[1] === 'png' ? png : image[1] === 'jpeg' ? jpeg : webp)) {
    throw new ErreurHttp(400, 'Le contenu de la photo ne correspond pas au format annoncé.');
  }
  return v;
}

function codeInvitation(): string {
  let s = '';
  while (s.replace(/-/g, '').length < 12) {
    const octet = randomBytes(1)[0];
    if (octet >= 248) continue; // 248 = 8 × 31 : évite de favoriser certaines lettres
    s += ALPHABET[octet % ALPHABET.length];
    if (s.length === 4 || s.length === 9) s += '-';
  }
  return s;
}
const normaliserCode = (c: string) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function cheminValide(p: unknown): p is string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 512) return false;
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0')) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

export function creerServeur(opts: Options) {
  const tailleMax = opts.tailleMaxOctets ?? 50 * 1024 * 1024;
  fs.mkdirSync(path.join(opts.dossierDonnees, 'blobs'), { recursive: true });
  const db = new DatabaseSync(path.join(opts.dossierDonnees, 'cordee.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS coffres (id TEXT PRIMARY KEY, nom TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 0, cree_le INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS membres (id TEXT PRIMARY KEY, coffre_id TEXT NOT NULL, nom TEXT NOT NULL,
      jeton_hash TEXT NOT NULL UNIQUE, cree_le INTEGER NOT NULL, revoque INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS invitations (code_hash TEXT PRIMARY KEY, coffre_id TEXT NOT NULL, cree_par TEXT NOT NULL,
      expire_le INTEGER NOT NULL, utilisations_restantes INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS fichiers (coffre_id TEXT NOT NULL, chemin TEXT NOT NULL, hash TEXT, supprime INTEGER NOT NULL,
      rev INTEGER NOT NULL, auteur TEXT NOT NULL, modifie_le INTEGER NOT NULL, PRIMARY KEY (coffre_id, chemin));
    CREATE TABLE IF NOT EXISTS changements (coffre_id TEXT NOT NULL, rev INTEGER NOT NULL, chemin TEXT NOT NULL, hash TEXT,
      supprime INTEGER NOT NULL, auteur TEXT NOT NULL, le INTEGER NOT NULL, type TEXT NOT NULL DEFAULT 'fichier', PRIMARY KEY (coffre_id, rev));
    CREATE TABLE IF NOT EXISTS dossiers (coffre_id TEXT NOT NULL, chemin TEXT NOT NULL, rev INTEGER NOT NULL,
      supprime INTEGER NOT NULL, auteur TEXT NOT NULL, modifie_le INTEGER NOT NULL, PRIMARY KEY (coffre_id, chemin));
  `);
  // Migration additive : les coffres et les jetons des installations existantes restent valables.
  const colonnesMembres = db.prepare('PRAGMA table_info(membres)').all() as Array<{ name: string }>;
  if (!colonnesMembres.some((c) => c.name === 'avatar')) db.exec('ALTER TABLE membres ADD COLUMN avatar TEXT');
  if (!colonnesMembres.some((c) => c.name === 'version')) db.exec('ALTER TABLE membres ADD COLUMN version TEXT');
  if (!colonnesMembres.some((c) => c.name === 'vu_le')) db.exec('ALTER TABLE membres ADD COLUMN vu_le INTEGER');
  if (!colonnesMembres.some((c) => c.name === 'presence_masquee')) db.exec('ALTER TABLE membres ADD COLUMN presence_masquee INTEGER NOT NULL DEFAULT 0');
  const colonnesChangements = db.prepare('PRAGMA table_info(changements)').all() as Array<{ name: string }>;
  if (!colonnesChangements.some((c) => c.name === 'type')) db.exec("ALTER TABLE changements ADD COLUMN type TEXT NOT NULL DEFAULT 'fichier'");
  db.exec(`CREATE INDEX IF NOT EXISTS changements_chemin_type_rev ON changements (coffre_id, chemin, type, rev);
    CREATE INDEX IF NOT EXISTS changements_auteur_rev ON changements (coffre_id, auteur, rev);`);

  const selectionChangements = `SELECT c.rev, c.chemin, c.hash, c.supprime, c.le, c.auteur AS auteurId,
    mb.nom AS auteur, c.type, CASE WHEN c.type = 'dossier' THEN NULL ELSE
      (SELECT CASE WHEN precedent.supprime = 1 THEN NULL ELSE precedent.hash END FROM changements precedent
       WHERE precedent.coffre_id = c.coffre_id AND precedent.chemin = c.chemin AND precedent.type = 'fichier'
         AND precedent.rev < c.rev ORDER BY precedent.rev DESC LIMIT 1) END AS avantHash
    FROM changements c LEFT JOIN membres mb ON mb.id = c.auteur`;
  const exposerChangement = (c: ChangementStocke) => ({ ...c, supprime: c.supprime === 1 });

  function membresDuCoffre(coffreId: string) {
    return db.prepare('SELECT id, nom, avatar, version, CASE WHEN presence_masquee = 1 THEN NULL ELSE vu_le END AS vu_le, cree_le AS arrive_le FROM membres WHERE coffre_id = ? AND revoque = 0 ORDER BY cree_le').all(coffreId);
  }

  function fichierBloquant(coffreId: string, chemin: string, inclureLui = true) {
    const parties = chemin.split('/');
    const parents = parties.slice(0, inclureLui ? parties.length : -1).map((_, i) => parties.slice(0, i + 1).join('/'));
    if (!parents.length) return undefined;
    return db.prepare(`SELECT chemin FROM fichiers WHERE coffre_id = ? AND supprime = 0
      AND chemin IN (${parents.map(() => '?').join(',')}) LIMIT 1`).get(coffreId, ...parents);
  }

  function aDesDescendants(coffreId: string, chemin: string) {
    const prefixe = chemin + '/';
    return !!db.prepare(`SELECT 1 FROM fichiers WHERE coffre_id = ? AND supprime = 0 AND substr(chemin, 1, length(?)) = ?
      UNION ALL SELECT 1 FROM dossiers WHERE coffre_id = ? AND supprime = 0 AND substr(chemin, 1, length(?)) = ? LIMIT 1`)
      .get(coffreId, prefixe, prefixe, coffreId, prefixe, prefixe);
  }

  function lienInvitation(code: string): string | null {
    if (!opts.urlPublique) return null;
    const serveur = opts.urlPublique.replace(/\/$/, '');
    if (opts.pageInvitation) return `${opts.pageInvitation}#serveur=${encodeURIComponent(serveur)}&code=${code}`;
    return `${serveur}/rejoindre/${code}`;
  }

  const codeCreationHash = sha256(opts.codeCreation);
  const abonnes = new Map<string, Set<http.ServerResponse>>();
  // Le chemin de la note reste en mémoire seulement ; seule la dernière activité visible est conservée.
  // L'extension la renouvelle toutes les 45 s ; sans nouvelle depuis 90 s, le membre n'est plus « là ».
  const presences = new Map<string, Map<string, { nom: string; chemin: string | null; jusqua: number }>>();
  function presenceDu(coffreId: string, sauf?: string) {
    const t = maintenant();
    const liste: Array<{ id: string; nom: string; chemin: string | null }> = [];
    for (const [id, p] of presences.get(coffreId) ?? []) {
      if (p.jusqua < t) { presences.get(coffreId)!.delete(id); continue; }
      if (id !== sauf) liste.push({ id, nom: p.nom, chemin: p.chemin });
    }
    return liste;
  }
  const limites = new Map<string, { n: number; fin: number }>();

  // Limite les tentatives sur les routes qui acceptent un code, pour empêcher de les deviner.
  function limiter(ip: string) {
    const t = maintenant();
    const l = limites.get(ip);
    if (!l || l.fin < t) { limites.set(ip, { n: 1, fin: t + 60_000 }); return; }
    if (++l.n > 10) throw new ErreurHttp(429, 'Trop de tentatives, réessaie dans une minute.');
  }

  function membre(req: http.IncomingMessage, coffreId: string) {
    const auth = req.headers.authorization || '';
    const jeton = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!jeton) throw new ErreurHttp(401, 'Jeton manquant.');
    const m = db.prepare('SELECT id, nom, coffre_id, version FROM membres WHERE jeton_hash = ? AND revoque = 0').get(sha256(jeton)) as
      | { id: string; nom: string; coffre_id: string; version: string | null } | undefined;
    if (!m || m.coffre_id !== coffreId) throw new ErreurHttp(403, "Tu n'as pas accès à ce coffre.");
    // Version de l'extension de ce membre : permet de repérer, depuis le coffre, un ami dont l'extension est trop ancienne
    // (avant la 0.1.5, elle ne sait pas créer ni supprimer de dossiers). Jamais un contenu : seulement « 0.1.5 ».
    const version = String(req.headers['x-cordee-version'] || '');
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version) && version !== m.version) {
      db.prepare('UPDATE membres SET version = ? WHERE id = ?').run(version, m.id);
      m.version = version;
    }
    return m;
  }

  function nouveauMembre(coffreId: string, nom: string) {
    const jeton = identifiant(32);
    const id = identifiant();
    db.prepare('INSERT INTO membres (id, coffre_id, nom, jeton_hash, cree_le) VALUES (?, ?, ?, ?, ?)').run(id, coffreId, nom, sha256(jeton), maintenant());
    return { id, jeton };
  }

  function nomValide(n: unknown, quoi: string): string {
    const s = typeof n === 'string' ? n.trim() : '';
    if (s.length < 1 || s.length > 60) throw new ErreurHttp(400, `${quoi} : entre 1 et 60 caractères.`);
    return s;
  }

  const cheminBlob = (coffreId: string, hash: string) => path.join(opts.dossierDonnees, 'blobs', coffreId, hash.slice(0, 2), hash);

  function comparer(coffreId: string, changement: ChangementStocke) {
    const vide = { changement: exposerChangement(changement), avant: null, apres: null };
    if (changement.type === 'dossier') return { ...vide, raison: 'dossier' };
    if (!/\.(md|txt|csv)$/i.test(changement.chemin)) return { ...vide, raison: 'binaire' };
    const hashes = [changement.avantHash, changement.supprime ? null : changement.hash];
    // Tester les deux tailles avant toute lecture, même si seule la version précédente est volumineuse.
    for (const hash of hashes) {
      if (hash && fs.statSync(cheminBlob(coffreId, hash)).size > TAILLE_MAX_COMPARAISON) return { ...vide, raison: 'volumineux' };
    }
    const textes: Array<string | null> = [];
    for (const hash of hashes) {
      if (!hash) { textes.push(null); continue; }
      const fd = fs.openSync(cheminBlob(coffreId, hash), 'r');
      try {
        if (fs.fstatSync(fd).size > TAILLE_MAX_COMPARAISON) return { ...vide, raison: 'volumineux' };
        // Lecture strictement bornée, y compris si le fichier change après le stat.
        const contenu = Buffer.alloc(TAILLE_MAX_COMPARAISON + 1);
        let total = 0;
        while (total < contenu.length) {
          const lus = fs.readSync(fd, contenu, total, contenu.length - total, total);
          if (!lus) break;
          total += lus;
        }
        if (total > TAILLE_MAX_COMPARAISON) return { ...vide, raison: 'volumineux' };
        const octets = contenu.subarray(0, total);
        if (octets.includes(0)) return { ...vide, raison: 'binaire' };
        try { textes.push(new TextDecoder('utf-8', { fatal: true }).decode(octets)); }
        catch { return { ...vide, raison: 'binaire' }; }
      } finally { fs.closeSync(fd); }
    }
    return { changement: exposerChangement(changement), avant: textes[0], apres: textes[1], raison: null };
  }

  function lireCorps(req: http.IncomingMessage, limite: number): Promise<Buffer> {
    return new Promise((ok, ko) => {
      const morceaux: Buffer[] = [];
      let total = 0;
      req.on('data', (c: Buffer) => {
        total += c.length;
        if (total > limite) { ko(new ErreurHttp(413, 'Fichier trop gros pour ce serveur.')); req.destroy(); return; }
        morceaux.push(c);
      });
      req.on('end', () => ok(Buffer.concat(morceaux)));
      req.on('error', ko);
    });
  }
  async function lireJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    const b = await lireCorps(req, 64 * 1024);
    try { return JSON.parse(b.toString('utf8') || '{}'); } catch { throw new ErreurHttp(400, 'JSON invalide.'); }
  }

  function prevenir(coffreId: string, rev: number) {
    for (const res of abonnes.get(coffreId) ?? []) res.write(`data: ${JSON.stringify({ rev })}\n\n`);
  }

  function envoyer(res: http.ServerResponse, statut: number, corps: unknown) {
    res.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(corps));
  }

  async function router(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || '/', 'http://local');
    const p = url.pathname;
    const m = req.method || 'GET';
    const ipProxy = opts.derriereProxy ? req.headers['x-real-ip'] : undefined;
    const ip = (typeof ipProxy === 'string' && ipProxy) || req.socket.remoteAddress || '';
    let r: RegExpMatchArray | null;

    if (m === 'GET' && p === '/api/sante') return envoyer(res, 200, { ok: true, version: 1 });

    if (m === 'POST' && p === '/api/coffres') {
      limiter(ip);
      const b = await lireJson(req);
      const essai = Buffer.from(sha256(String(b.codeCreation ?? '')));
      if (!timingSafeEqual(essai, Buffer.from(codeCreationHash))) throw new ErreurHttp(403, 'Code de création incorrect.');
      const nom = nomValide(b.nom, 'Nom du coffre');
      const prenom = nomValide(b.prenom, 'Prénom');
      const id = identifiant(12);
      db.prepare('INSERT INTO coffres (id, nom, cree_le) VALUES (?, ?, ?)').run(id, nom, maintenant());
      const mb = nouveauMembre(id, prenom);
      return envoyer(res, 201, { coffreId: id, nom, jeton: mb.jeton });
    }

    if (m === 'POST' && p === '/api/rejoindre') {
      limiter(ip);
      const b = await lireJson(req);
      const prenom = nomValide(b.prenom, 'Prénom');
      const inv = db.prepare('SELECT code_hash, coffre_id, expire_le, utilisations_restantes FROM invitations WHERE code_hash = ?')
        .get(sha256(normaliserCode(String(b.code ?? '')))) as { code_hash: string; coffre_id: string; expire_le: number; utilisations_restantes: number } | undefined;
      if (!inv || inv.expire_le < maintenant() || inv.utilisations_restantes < 1) throw new ErreurHttp(404, 'Invitation inconnue ou expirée.');
      db.prepare('UPDATE invitations SET utilisations_restantes = utilisations_restantes - 1 WHERE code_hash = ?').run(inv.code_hash);
      const c = db.prepare('SELECT nom FROM coffres WHERE id = ?').get(inv.coffre_id) as { nom: string };
      const mb = nouveauMembre(inv.coffre_id, prenom);
      return envoyer(res, 201, { coffreId: inv.coffre_id, nom: c.nom, jeton: mb.jeton });
    }

    if (m === 'GET' && (r = p.match(/^\/rejoindre\/([A-Za-z0-9-]{1,20})$/))) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Rejoindre un coffre Cordée</title>
<body style="font-family:system-ui;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.6">
<h1>Tu es invité dans un coffre Obsidian</h1>
<ol><li>Installe l'extension <b>Cordée</b> dans Obsidian.</li>
<li>Dans ses réglages, choisis <b>Rejoindre</b> et colle le lien de cette page.</li></ol>
<p>Code d'invitation : <code>${r[1].replace(/[^A-Za-z0-9-]/g, '')}</code></p></body>`);
    }

    if ((r = p.match(/^\/api\/coffres\/([A-Za-z0-9_-]+)(\/.*)?$/))) {
      const coffreId = r[1];
      const sous = r[2] || '';
      const moi = membre(req, coffreId);
      const coffre = db.prepare('SELECT id, nom, rev FROM coffres WHERE id = ?').get(coffreId) as { id: string; nom: string; rev: number };

      if (m === 'GET' && sous === '') {
        // Le sondage fréquent de la synchronisation n'a pas besoin de télécharger les photos.
        if (url.searchParams.get('revision') === '1') return envoyer(res, 200, { id: coffre.id, nom: coffre.nom, rev: coffre.rev, presence: presenceDu(coffreId, moi.id) });
        const membres = membresDuCoffre(coffreId);
        return envoyer(res, 200, { id: coffre.id, nom: coffre.nom, rev: coffre.rev, moi: moi.nom, moiId: moi.id, membres });
      }

      if (m === 'PUT' && sous === '/profil') {
        const b = await lireJson(req);
        if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ErreurHttp(400, 'Indique un nom ou une photo de profil.');
        const changerNom = Object.hasOwn(b, 'nom');
        const changerAvatar = Object.hasOwn(b, 'avatar');
        if (!changerNom && !changerAvatar) throw new ErreurHttp(400, 'Indique un nom ou une photo de profil.');
        // Tout valider avant l'écriture : une photo incorrecte ne doit pas changer le nom, ni l'inverse.
        const nom = changerNom ? nomValide(b.nom, 'Nom du profil') : null;
        const avatar = changerAvatar ? avatarValide(b.avatar) : null;
        const profil = db.prepare(`UPDATE membres SET nom = CASE WHEN ? THEN ? ELSE nom END,
          avatar = CASE WHEN ? THEN ? ELSE avatar END WHERE id = ? AND coffre_id = ? AND revoque = 0 RETURNING id, nom, avatar`)
          .get(changerNom ? 1 : 0, nom, changerAvatar ? 1 : 0, avatar, moi.id, coffreId);
        if (!profil) throw new ErreurHttp(403, "Tu n'as plus accès à ce coffre.");
        return envoyer(res, 200, profil);
      }

      if (m === 'POST' && sous === '/invitations') {
        const code = codeInvitation();
        const expire = maintenant() + 7 * 24 * 3600_000;
        db.prepare('INSERT INTO invitations (code_hash, coffre_id, cree_par, expire_le, utilisations_restantes) VALUES (?, ?, ?, ?, 5)')
          .run(sha256(normaliserCode(code)), coffreId, moi.id, expire);
        const lien = lienInvitation(code);
        return envoyer(res, 201, { code, lien, expireLe: expire, utilisations: 5 });
      }

      if (m === 'DELETE' && sous === '/membres/moi') {
        db.prepare('UPDATE membres SET revoque = 1 WHERE id = ?').run(moi.id);
        return envoyer(res, 200, { ok: true });
      }

      if (m === 'GET' && sous === '/changements') {
        const depuis = Math.max(0, Number(url.searchParams.get('depuis')) || 0);
        const lignes = db.prepare(`${selectionChangements} WHERE c.coffre_id = ? AND c.rev > ? ORDER BY c.rev LIMIT 1001`).all(coffreId, depuis) as unknown as ChangementStocke[];
        const plus = lignes.length > 1000;
        const changements = lignes.slice(0, 1000).map(exposerChangement);
        return envoyer(res, 200, { rev: coffre.rev, changements, plus });
      }

      if (m === 'POST' && sous === '/presence') {
        const b = await lireJson(req);
        const chemin = b.chemin === null || b.chemin === undefined ? null : b.chemin;
        if (chemin !== null && !cheminValide(chemin)) throw new ErreurHttp(400, 'Chemin invalide.');
        if (b.parti === true) {
          presences.get(coffreId)?.delete(moi.id);
          // Masquer sa présence cache aussi l'ancienne date, sans actualiser sa dernière activité.
          // Une simple fermeture d'Obsidian ne change pas cette préférence persistante.
          if (b.masquee === true) db.prepare('UPDATE membres SET presence_masquee = 1 WHERE id = ? AND presence_masquee = 0').run(moi.id);
        }
        else {
          const t = maintenant();
          // Les ouvertures de notes peuvent être rapprochées : au plus une date écrite toutes les 30 s.
          db.prepare(`UPDATE membres SET vu_le = CASE WHEN vu_le IS NULL OR vu_le <= ? THEN ? ELSE vu_le END,
            presence_masquee = 0 WHERE id = ? AND (presence_masquee = 1 OR vu_le IS NULL OR vu_le <= ?)`)
            .run(t - 30_000, t, moi.id, t - 30_000);
          if (!presences.has(coffreId)) presences.set(coffreId, new Map());
          presences.get(coffreId)!.set(moi.id, { nom: moi.nom, chemin, jusqua: t + 90_000 });
        }
        return envoyer(res, 200, { presence: presenceDu(coffreId, moi.id) });
      }

      // Historique d'une note : toutes ses versions, de la plus récente à la plus ancienne.
      if (m === 'GET' && sous === '/historique') {
        const chemin = url.searchParams.get('chemin') || '';
        if (!cheminValide(chemin)) throw new ErreurHttp(400, 'Chemin invalide.');
        const demande = Number(url.searchParams.get('limite') || 50);
        const limite = Number.isFinite(demande) ? Math.max(1, Math.min(200, Math.floor(demande))) : 50;
        const lignes = db.prepare(`${selectionChangements} WHERE c.coffre_id = ? AND c.chemin = ? AND c.type = 'fichier' ORDER BY c.rev DESC LIMIT ?`)
          .all(coffreId, chemin, limite) as unknown as ChangementStocke[];
        return envoyer(res, 200, { chemin, changements: lignes.map(exposerChangement), membres: membresDuCoffre(coffreId) });
      }

      if (m === 'GET' && sous === '/activite') {
        const demande = Number(url.searchParams.get('limite') || 40);
        const limite = Number.isFinite(demande) ? Math.max(1, Math.min(100, Math.floor(demande))) : 40;
        const auteur = url.searchParams.get('auteur') || '';
        if (auteur && !/^[A-Za-z0-9_-]+$/.test(auteur)) throw new ErreurHttp(400, 'Identifiant de membre invalide.');
        const lignes = db.prepare(`${selectionChangements} WHERE c.coffre_id = ? ${auteur ? 'AND c.auteur = ?' : ''}
          ORDER BY c.rev DESC LIMIT ?`).all(...(auteur ? [coffreId, auteur, limite + 1] : [coffreId, limite + 1])) as unknown as ChangementStocke[];
        return envoyer(res, 200, { rev: coffre.rev, moiId: moi.id, membres: membresDuCoffre(coffreId),
          changements: lignes.slice(0, limite).map(exposerChangement), plus: lignes.length > limite });
      }

      if (m === 'GET' && (r = sous.match(/^\/revisions\/([0-9]+)$/))) {
        const rev = Number(r[1]);
        if (!Number.isSafeInteger(rev) || rev < 1) throw new ErreurHttp(400, 'Révision invalide.');
        const changement = db.prepare(`${selectionChangements} WHERE c.coffre_id = ? AND c.rev = ?`).get(coffreId, rev) as unknown as ChangementStocke | undefined;
        if (!changement) throw new ErreurHttp(404, 'Révision introuvable dans ce coffre.');
        return envoyer(res, 200, comparer(coffreId, changement));
      }

      if (m === 'GET' && sous === '/evenements') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`data: ${JSON.stringify({ rev: coffre.rev })}\n\n`);
        if (!abonnes.has(coffreId)) abonnes.set(coffreId, new Set());
        abonnes.get(coffreId)!.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
        req.on('close', () => { clearInterval(ping); abonnes.get(coffreId)?.delete(res); });
        return;
      }

      if ((r = sous.match(/^\/blobs\/([a-f0-9]{64})$/))) {
        const hash = r[1];
        const f = cheminBlob(coffreId, hash);
        if (m === 'GET') {
          if (!fs.existsSync(f)) throw new ErreurHttp(404, 'Contenu introuvable.');
          res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
          return fs.createReadStream(f).pipe(res);
        }
        if (m === 'PUT') {
          const corps = await lireCorps(req, tailleMax);
          if (sha256(corps) !== hash) throw new ErreurHttp(400, 'Le contenu ne correspond pas à son empreinte.');
          if (!fs.existsSync(f)) {
            fs.mkdirSync(path.dirname(f), { recursive: true });
            const tmp = `${f}.${identifiant(6)}.tmp`;
            fs.writeFileSync(tmp, corps);
            fs.renameSync(tmp, f);
          }
          return envoyer(res, 200, { ok: true });
        }
      }

      if (m === 'POST' && sous === '/fichiers') {
        const b = await lireJson(req);
        if (!cheminValide(b.chemin)) throw new ErreurHttp(400, 'Chemin de fichier invalide.');
        const hash = b.hash === null ? null : String(b.hash ?? '');
        const base = b.base === null || b.base === undefined ? null : String(b.base);
        if (hash !== null && !HASH_VALIDE.test(hash)) throw new ErreurHttp(400, 'Empreinte invalide.');
        if (hash !== null && !fs.existsSync(cheminBlob(coffreId, hash))) throw new ErreurHttp(400, "Contenu pas encore envoyé : fais d'abord le PUT du blob.");
        // Écriture conditionnelle : on n'accepte que si l'auteur partait de la version actuelle du serveur.
        db.exec('BEGIN IMMEDIATE');
        try {
          const actuel = db.prepare('SELECT hash, supprime FROM fichiers WHERE coffre_id = ? AND chemin = ?').get(coffreId, b.chemin) as { hash: string | null; supprime: number } | undefined;
          const hashActuel = actuel && !actuel.supprime ? actuel.hash : null;
          if (hash !== null && (fichierBloquant(coffreId, b.chemin, false)
            || db.prepare('SELECT 1 FROM dossiers WHERE coffre_id = ? AND chemin = ? AND supprime = 0').get(coffreId, b.chemin)
            || aDesDescendants(coffreId, b.chemin))) {
            db.exec('ROLLBACK'); return envoyer(res, 409, { erreur: 'Ce chemin est occupé par un dossier ou un fichier parent.', actuel: hashActuel });
          }
          if (hashActuel !== base) { db.exec('ROLLBACK'); return envoyer(res, 409, { erreur: 'Version périmée.', actuel: hashActuel }); }
          if (hashActuel === hash) { db.exec('COMMIT'); return envoyer(res, 200, { rev: coffre.rev, inchange: true }); }
          const { rev } = db.prepare('UPDATE coffres SET rev = rev + 1 WHERE id = ? RETURNING rev').get(coffreId) as { rev: number };
          const t = maintenant();
          db.prepare(`INSERT INTO fichiers (coffre_id, chemin, hash, supprime, rev, auteur, modifie_le) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (coffre_id, chemin) DO UPDATE SET hash = excluded.hash, supprime = excluded.supprime, rev = excluded.rev, auteur = excluded.auteur, modifie_le = excluded.modifie_le`)
            .run(coffreId, b.chemin, hash, hash === null ? 1 : 0, rev, moi.id, t);
          db.prepare('INSERT INTO changements (coffre_id, rev, chemin, hash, supprime, auteur, le) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(coffreId, rev, b.chemin, hash, hash === null ? 1 : 0, moi.id, t);
          db.exec('COMMIT');
          prevenir(coffreId, rev);
          return envoyer(res, 200, { rev });
        } catch (e) {
          try { db.exec('ROLLBACK'); } catch { /* déjà annulée */ }
          throw e;
        }
      }

      if (m === 'POST' && sous === '/dossiers') {
        const b = await lireJson(req);
        if (!b || !cheminValide(b.chemin)) throw new ErreurHttp(400, 'Chemin de dossier invalide.');
        if (typeof b.supprime !== 'boolean' || (b.baseRev !== null && (!Number.isSafeInteger(b.baseRev) || Number(b.baseRev) < 1))) {
          throw new ErreurHttp(400, 'Indique un état de dossier et une révision de base valide.');
        }
        db.exec('BEGIN IMMEDIATE');
        try {
          const actuel = db.prepare('SELECT rev, supprime FROM dossiers WHERE coffre_id = ? AND chemin = ?').get(coffreId, b.chemin) as { rev: number; supprime: number } | undefined;
          const actif = !!actuel && actuel.supprime === 0;
          const revActuelle = actif ? actuel!.rev : null;
          if (fichierBloquant(coffreId, b.chemin)) {
            db.exec('ROLLBACK'); return envoyer(res, 409, { erreur: 'Ce chemin est occupé par un fichier.', actuel: revActuelle });
          }
          if (b.supprime && aDesDescendants(coffreId, b.chemin)) {
            db.exec('ROLLBACK'); return envoyer(res, 409, { erreur: 'Le dossier contient encore des fichiers ou des sous-dossiers.', actuel: revActuelle });
          }
          if (b.supprime === !actif) {
            db.exec('COMMIT'); return envoyer(res, 200, { rev: actuel?.rev ?? coffre.rev, inchange: true });
          }
          if (b.baseRev !== revActuelle) { db.exec('ROLLBACK'); return envoyer(res, 409, { erreur: 'Version de dossier périmée.', actuel: revActuelle }); }
          const { rev } = db.prepare('UPDATE coffres SET rev = rev + 1 WHERE id = ? RETURNING rev').get(coffreId) as { rev: number };
          const t = maintenant();
          db.prepare(`INSERT INTO dossiers (coffre_id, chemin, rev, supprime, auteur, modifie_le) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (coffre_id, chemin) DO UPDATE SET rev = excluded.rev, supprime = excluded.supprime, auteur = excluded.auteur, modifie_le = excluded.modifie_le`)
            .run(coffreId, b.chemin, rev, b.supprime ? 1 : 0, moi.id, t);
          db.prepare("INSERT INTO changements (coffre_id, rev, chemin, hash, supprime, auteur, le, type) VALUES (?, ?, ?, NULL, ?, ?, ?, 'dossier')")
            .run(coffreId, rev, b.chemin, b.supprime ? 1 : 0, moi.id, t);
          db.exec('COMMIT');
          prevenir(coffreId, rev);
          return envoyer(res, 200, { rev });
        } catch (e) {
          try { db.exec('ROLLBACK'); } catch { /* déjà annulée */ }
          throw e;
        }
      }
    }

    throw new ErreurHttp(404, 'Route inconnue.');
  }

  const serveur = http.createServer(async (req, res) => {
    // L'extension tourne dans Obsidian (origine app://obsidian.md) : on autorise toutes les origines,
    // l'accès étant protégé par un jeton dans l'en-tête, jamais par un cookie.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try {
      await router(req, res);
    } catch (e) {
      const statut = e instanceof ErreurHttp ? e.statut : 500;
      if (statut === 500) console.error(e);
      if (!res.headersSent) envoyer(res, statut, { erreur: e instanceof ErreurHttp ? e.message : 'Erreur interne.' });
      else res.end();
    }
  });

  return {
    serveur,
    fermer() {
      for (const s of abonnes.values()) for (const r of s) r.end();
      serveur.close();
      db.close();
    },
  };
}
