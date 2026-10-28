const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')
const { nameKey, NAME_MAX } = require('./names')

// Chaque entrée fait passer la base à la version suivante (PRAGMA user_version) : du SQL, ou une
// fonction qui reçoit la base.
const migrations = [
  `CREATE TABLE players (
     id TEXT PRIMARY KEY,
     token_hash TEXT NOT NULL UNIQUE,
     name TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE scores (
     game TEXT NOT NULL,
     player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
     score INTEGER NOT NULL,
     details TEXT NOT NULL,
     at INTEGER NOT NULL,
     PRIMARY KEY (game, player_id)
   );
   CREATE INDEX scores_board ON scores (game, score DESC, at ASC);`,
  // Les pseudos deviennent uniques (sans tenir compte des majuscules) : les doublons d'avant gardent
  // le leur, suivi d'un numéro, sauf le plus ancien.
  (db) => {
    db.exec('ALTER TABLE players ADD COLUMN name_key TEXT')
    const set = db.prepare('UPDATE players SET name = ?, name_key = ? WHERE id = ?')
    const taken = new Set()
    for (const p of db.prepare('SELECT id, name FROM players WHERE name IS NOT NULL ORDER BY created_at').all()) {
      let name = p.name
      for (let n = 2; taken.has(nameKey(name)); n++) {
        const suffix = ` ${n}`
        name = [...p.name].slice(0, NAME_MAX - suffix.length).join('') + suffix
      }
      taken.add(nameKey(name))
      set.run(name, nameKey(name), p.id)
    }
    db.exec('CREATE UNIQUE INDEX players_name ON players (name_key)')
  },
  // Les badges gagnés en jeu (Ronnie.io : avoir mangé Ronnie).
  `CREATE TABLE badges (
     player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
     badge TEXT NOT NULL,
     at INTEGER NOT NULL,
     PRIMARY KEY (player_id, badge)
   );`,
  // Ronnie.io : les parties jouées et les joueurs mangés de chacun (des skins s'en débloquent).
  `CREATE TABLE blob_stats (
     player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
     games INTEGER NOT NULL DEFAULT 0,
     kills INTEGER NOT NULL DEFAULT 0
   );`,
  // Ronnheim : ce que chaque joueur garde (position, santé, inventaire), et le monde (souches, feux).
  `CREATE TABLE ronnheim_players (
     player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
     data TEXT NOT NULL,
     at INTEGER NOT NULL
   );
   CREATE TABLE ronnheim_world (
     k TEXT PRIMARY KEY,
     v TEXT NOT NULL
   );`
]

// Ouvre (ou crée) la base : `file` vaut ':memory:' pour les tests.
function open (file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  const version = db.pragma('user_version', { simple: true })
  for (let v = version; v < migrations.length; v++) {
    db.transaction(() => {
      const m = migrations[v]
      if (typeof m === 'function') m(db)
      else db.exec(m)
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
  return db
}

module.exports = { open }
