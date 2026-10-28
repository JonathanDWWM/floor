const express = require('express')
const { players: makePlayers, HttpError } = require('./players')
const { rateLimit } = require('./ratelimit')
const games = require('./games')
const { live } = require('./live')
const release = require('./version')
const modules = require('./modules')
const { releases } = require('./releases')

const BOARD_MAX = 100

function createApp (db, { trustProxy = false, now, releasesDir = null, publishToken = null } = {}) {
  const players = makePlayers(db)
  const app = express()
  // Pour Ronnie.io, qui s'ouvre sur le serveur HTTP (voir src/blob).
  app.locals.players = players
  app.set('trust proxy', trustProxy)
  app.disable('x-powered-by')
  app.use(express.json({ limit: '16kb' }))

  // Répond, et dit quelle version tourne (pour vérifier qu'un déploiement est passé).
  app.get('/health', (req, res) => res.json({ ok: true, ...release }))

  // Joueurs.
  app.post('/v1/players', rateLimit(20, 60 * 60 * 1000), (req, res) => {
    res.status(201).json(players.create(req.body?.name))
  })
  // Un pseudo est-il libre ? (pendant qu'on le tape)
  app.get('/v1/players/available', rateLimit(1200, 60 * 60 * 1000), players.auth(false), (req, res) => {
    res.json(players.available(String(req.query.name ?? ''), req.player?.id))
  })
  app.patch('/v1/players/me', players.auth(true), (req, res) => {
    res.json(players.rename(req.player.id, req.body?.name))
  })

  // Le jeu à deux : présence, invitations, parties.
  app.use('/v1/live', live(db, players, { now }))

  // Les versions de Ronnheim, d'où le jeu se met à jour (voir src/releases.js).
  if (releasesDir) app.use('/v1/ronnheim', releases({ dir: releasesDir, token: publishToken }))

  // Les modules que Ronnie propose de télécharger.
  app.get('/v1/modules', (req, res) => res.json({ modules }))

  // Jeux.
  app.get('/v1/games', (req, res) => {
    res.json(Object.values(games).map((g) => ({ id: g.id, name: g.name, order: g.order })))
  })
  app.param('game', (req, res, next, id) => {
    req.game = games[id]
    if (!req.game) return next(new HttpError(404, 'Jeu inconnu'))
    next()
  })

  // Requêtes par jeu : le classement est un score par joueur, son meilleur.
  const queries = {}
  for (const g of Object.values(games)) {
    const better = g.order === 'asc' ? '<' : '>'
    const dir = g.order === 'asc' ? 'ASC' : 'DESC'
    queries[g.id] = {
      // Gardé seulement s'il bat le précédent.
      upsert: db.prepare(`INSERT INTO scores (game, player_id, score, details, at) VALUES (@game, @player, @score, @details, @at)
        ON CONFLICT (game, player_id) DO UPDATE SET score = excluded.score, details = excluded.details, at = excluded.at
        WHERE excluded.score ${better} scores.score`),
      board: db.prepare(`SELECT s.player_id, p.name, s.score, s.details, s.at FROM scores s JOIN players p ON p.id = s.player_id
        WHERE s.game = ? ORDER BY s.score ${dir}, s.at ASC LIMIT ?`),
      // À égalité, le premier arrivé passe devant.
      entry: db.prepare(`SELECT s.player_id, p.name, s.score, s.details, s.at,
          (SELECT COUNT(*) FROM scores o WHERE o.game = s.game AND (o.score ${better} s.score OR (o.score = s.score AND o.at < s.at))) + 1 AS rank
        FROM scores s JOIN players p ON p.id = s.player_id WHERE s.game = ? AND s.player_id = ?`),
      players: db.prepare('SELECT COUNT(*) AS n FROM scores WHERE game = ?')
    }
  }
  const row = (r, rank, me) => ({ rank, name: r.name, score: r.score, details: JSON.parse(r.details), at: r.at, me: me === r.player_id })

  app.post('/v1/games/:game/scores', rateLimit(120, 60 * 60 * 1000), players.auth(true), (req, res) => {
    const { score, details } = req.game.score(req.body || {})
    const q = queries[req.game.id]
    const changed = q.upsert.run({ game: req.game.id, player: req.player.id, score, details: JSON.stringify(details), at: Date.now() }).changes > 0
    const best = q.entry.get(req.game.id, req.player.id)
    res.status(changed ? 201 : 200).json({ record: changed, best: row(best, best.rank, req.player.id) })
  })

  app.get('/v1/games/:game/leaderboard', players.auth(false), (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), BOARD_MAX)
    const q = queries[req.game.id]
    const me = req.player?.id
    const entries = q.board.all(req.game.id, limit).map((r, k) => row(r, k + 1, me))
    const mine = me ? q.entry.get(req.game.id, me) : null
    res.json({
      game: req.game.id,
      players: q.players.get(req.game.id).n,
      entries,
      me: mine ? row(mine, mine.rank, me) : null
    })
  })

  app.use((req, res) => res.status(404).json({ error: 'Introuvable' }))
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500
    if (status >= 500) console.error(err)
    res.status(status).json({ error: status >= 500 ? 'Erreur interne' : err.message })
  })
  return app
}

module.exports = { createApp }
