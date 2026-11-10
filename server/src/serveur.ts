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
      supprime INTEGER NOT NULL, auteur TEXT NOT NULL, le INTEGER NOT NULL, PRIMARY KEY (coffre_id, rev));
  `);

  const codeCreationHash = sha256(opts.codeCreation);
  const abonnes = new Map<string, Set<http.ServerResponse>>();
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
    const m = db.prepare('SELECT id, nom, coffre_id FROM membres WHERE jeton_hash = ? AND revoque = 0').get(sha256(jeton)) as
      | { id: string; nom: string; coffre_id: string } | undefined;
    if (!m || m.coffre_id !== coffreId) throw new ErreurHttp(403, "Tu n'as pas accès à ce coffre.");
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
    const ip = req.socket.remoteAddress || '';
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
        const membres = db.prepare('SELECT nom, cree_le AS arrive_le FROM membres WHERE coffre_id = ? AND revoque = 0 ORDER BY cree_le').all(coffreId);
        return envoyer(res, 200, { id: coffre.id, nom: coffre.nom, rev: coffre.rev, moi: moi.nom, membres });
      }

      if (m === 'POST' && sous === '/invitations') {
        const code = codeInvitation();
        const expire = maintenant() + 7 * 24 * 3600_000;
        db.prepare('INSERT INTO invitations (code_hash, coffre_id, cree_par, expire_le, utilisations_restantes) VALUES (?, ?, ?, ?, 5)')
          .run(sha256(normaliserCode(code)), coffreId, moi.id, expire);
        const lien = opts.urlPublique ? `${opts.urlPublique.replace(/\/$/, '')}/rejoindre/${code}` : null;
        return envoyer(res, 201, { code, lien, expireLe: expire, utilisations: 5 });
      }

      if (m === 'DELETE' && sous === '/membres/moi') {
        db.prepare('UPDATE membres SET revoque = 1 WHERE id = ?').run(moi.id);
        return envoyer(res, 200, { ok: true });
      }

      if (m === 'GET' && sous === '/changements') {
        const depuis = Math.max(0, Number(url.searchParams.get('depuis')) || 0);
        const lignes = db.prepare(`SELECT c.rev, c.chemin, c.hash, c.supprime, c.le, mb.nom AS auteur FROM changements c
          LEFT JOIN membres mb ON mb.id = c.auteur WHERE c.coffre_id = ? AND c.rev > ? ORDER BY c.rev LIMIT 1001`).all(coffreId, depuis) as Array<Record<string, unknown>>;
        const plus = lignes.length > 1000;
        const changements = lignes.slice(0, 1000).map((l) => ({ ...l, supprime: l.supprime === 1 }));
        return envoyer(res, 200, { rev: coffre.rev, changements, plus });
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
