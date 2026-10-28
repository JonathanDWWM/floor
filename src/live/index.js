const crypto = require('crypto')
const express = require('express')
const { HttpError } = require('../players')
const { nameKey } = require('../names')
const c4 = require('./connect4')
const riff = require('./riff')
const { clean, CHAT_KEEP } = require('../chat')

// En ligne : vu depuis moins de tant (Ronnie se signale toutes les quelques secondes, avec un pseudo).
const ONLINE_MS = 25 * 1000
const INVITE_MS = 60 * 1000
// Plus vu pendant une partie depuis tant : il l'a abandonnée.
const AWAY_MS = 45 * 1000
// Les invitations et les parties finies, gardées tant (pour qu'on voie leur fin).
const KEEP_MS = 10 * 60 * 1000
// Les jeux auxquels on peut inviter.
const GAMES = ['puissance-4', 'ronnie-io', 'riff-hero']
// Ceux qui se jouent dans une partie à deux.
const MATCHES = ['puissance-4', 'riff-hero']

// Le jeu à deux de floor : qui est en ligne, les invitations, les parties de Puissance 4 et les
// battles de Riff Hero. Tout vit en mémoire (un redémarrage les oublie) ; seules les victoires vont
// dans la base, au classement du jeu. `now` : l'horloge (les tests la font avancer).
function live (db, players, { now = Date.now } = {}) {
  const router = express.Router()
  const seen = new Map()
  const invites = new Map()
  const matches = new Map()
  const nameOf = db.prepare('SELECT name FROM players WHERE id = ?')
  const won = db.prepare(`INSERT INTO scores (game, player_id, score, details, at) VALUES (?, ?, 1, '{}', ?)
    ON CONFLICT (game, player_id) DO UPDATE SET score = scores.score + 1, at = excluded.at`)

  const name = (id) => nameOf.get(id)?.name ?? null
  const online = (id) => now() - (seen.get(id) ?? -Infinity) < ONLINE_MS
  const playing = (id) => [...matches.values()].find((m) => !m.over && m.players.includes(id))

  function end (m, winner, reason) {
    Object.assign(m, { over: true, winner, reason, endedAt: now() })
    if (winner === 1 || winner === 2) won.run(m.game, m.players[winner - 1], now())
  }

  // Les invitations périmées, les absents d'une partie, ce qui est fini depuis longtemps.
  function tidy () {
    const t = now()
    for (const inv of invites.values()) {
      if (inv.status === 'pending' && t - inv.at > INVITE_MS) inv.status = 'expired'
      if (t - inv.at > KEEP_MS) invites.delete(inv.id)
    }
    for (const m of matches.values()) {
      if (!m.over) {
        const away = m.players.findIndex((p) => t - (seen.get(p) ?? 0) > AWAY_MS)
        if (away >= 0) end(m, 2 - away, 'forfeit')
        // Le morceau fini depuis longtemps sans le score final de l'un : les scores qu'on a.
        else if (m.game === 'riff-hero' && t > m.startAt + riff.SONG_MS + riff.GRACE_MS) end(m, riff.winner(m.riff), 'score')
      } else if (t - m.endedAt > KEEP_MS) {
        matches.delete(m.id)
      }
    }
  }

  function start (first, second, game) {
    // `chat` : les messages des deux joueurs ({ player, text }), qui suivent dans la revanche.
    const m = { id: crypto.randomUUID(), game, players: [first, second], columns: c4.empty(), turn: 1, moves: 0, last: null, over: false, winner: null, reason: null, line: null, rematch: [false, false], next: null, chat: [] }
    // Riff Hero : la graine du morceau, quand il commence, où en est chacun.
    if (game === 'riff-hero') Object.assign(m, { seed: riff.seed(), startAt: now() + riff.LEAD_MS, riff: [riff.fresh(), riff.fresh()] })
    matches.set(m.id, m)
    return m
  }

  // La partie vue par `id` : `you` vaut 1 (il commence) ou 2 ; `winner` 1, 2, ou 3 pour un nul.
  function view (m, id) {
    const you = m.players.indexOf(id) + 1
    // Riff Hero : la graine, dans combien de millisecondes le morceau commence (négatif : commencé),
    // où en sont les deux joueurs.
    const song = m.game === 'riff-hero' ? { seed: m.seed, starts_in: m.startAt - now(), riff: m.riff } : {}
    return {
      id: m.id,
      game: m.game,
      ...song,
      players: m.players.map(name),
      you,
      columns: m.columns,
      turn: m.turn,
      moves: m.moves,
      last: m.last,
      over: m.over,
      winner: m.winner,
      reason: m.reason,
      line: m.line,
      rematch: { you: m.rematch[you - 1], them: m.rematch[2 - you] },
      next: m.next,
      // [nom, texte, le sien]...
      chat: m.chat.map((c) => [name(c.player), c.text, c.player === id])
    }
  }

  // Seulement les joueurs avec un pseudo ; chaque requête compte comme un signe de vie.
  router.use(players.auth(true), (req, res, next) => {
    if (!req.player.name) return next(new HttpError(403, 'Choisis d’abord un pseudo'))
    seen.set(req.player.id, now())
    tidy()
    next()
  })

  const invite = (req, mine) => {
    const inv = invites.get(req.params.id)
    if (!inv || (mine ? inv.from : inv.to) !== req.player.id) throw new HttpError(404, 'Invitation introuvable')
    if (inv.status !== 'pending') throw new HttpError(409, 'Invitation expirée')
    return inv
  }
  const match = (req) => {
    const m = matches.get(req.params.id)
    if (!m || !m.players.includes(req.player.id)) throw new HttpError(404, 'Partie introuvable')
    return m
  }

  // Le signe de vie : qui est en ligne, les invitations reçues, la dernière envoyée, la partie en cours.
  router.post('/ping', (req, res) => {
    const me = req.player.id
    const others = [...seen.keys()].filter((id) => id !== me && online(id)).map((id) => ({ name: name(id), busy: !!playing(id) }))
    const received = [...invites.values()].filter((i) => i.to === me && i.status === 'pending')
    const sent = [...invites.values()].filter((i) => i.from === me).sort((a, b) => b.at - a.at)[0]
    res.json({
      online: others.filter((o) => o.name).sort((a, b) => a.name.localeCompare(b.name)),
      invites: received.map((i) => ({ id: i.id, from: name(i.from), at: i.at, game: i.game })),
      sent: sent ? { id: sent.id, to: name(sent.to), status: sent.status, match: sent.match ?? null, game: sent.game } : null,
      match: playing(me)?.id ?? null
    })
  })

  router.post('/invites', (req, res) => {
    const me = req.player.id
    const to = typeof req.body?.to === 'string' ? nameKey(req.body.to.trim()) : ''
    const target = [...seen.keys()].find((id) => online(id) && name(id) && nameKey(name(id)) === to)
    if (!target) throw new HttpError(404, 'Joueur hors ligne')
    if (target === me) throw new HttpError(400, 'Pas contre toi-même')
    // Puissance 4 ou Riff Hero (une partie à deux), ou Ronnie.io (le monde de tous : on s'y retrouve).
    const game = req.body?.game ?? 'puissance-4'
    if (!GAMES.includes(game)) throw new HttpError(400, 'Jeu inconnu')
    if (MATCHES.includes(game) && (playing(me) || playing(target))) throw new HttpError(409, 'Déjà en partie')
    for (const i of invites.values()) if (i.from === me && i.status === 'pending') i.status = 'cancelled'
    const inv = { id: crypto.randomUUID(), from: me, to: target, at: now(), status: 'pending', match: null, game }
    invites.set(inv.id, inv)
    res.status(201).json({ id: inv.id })
  })

  router.post('/invites/:id/accept', (req, res) => {
    const inv = invite(req, false)
    if (!online(inv.from)) {
      inv.status = 'expired'
      throw new HttpError(409, 'Invitation expirée')
    }
    // Ronnie.io : pas de partie à créer, chacun rejoint le monde.
    if (inv.game === 'ronnie-io') {
      inv.status = 'accepted'
      return res.status(201).json({ game: 'ronnie-io' })
    }
    if (playing(inv.from) || playing(inv.to)) throw new HttpError(409, 'Déjà en partie')
    // Celui qui invite commence.
    const m = start(inv.from, inv.to, inv.game)
    Object.assign(inv, { status: 'accepted', match: m.id })
    res.status(201).json(view(m, req.player.id))
  })
  router.post('/invites/:id/decline', (req, res) => {
    invite(req, false).status = 'declined'
    res.json({ ok: true })
  })
  router.delete('/invites/:id', (req, res) => {
    invite(req, true).status = 'cancelled'
    res.json({ ok: true })
  })

  router.get('/matches/:id', (req, res) => {
    res.json(view(match(req), req.player.id))
  })

  router.post('/matches/:id/moves', (req, res) => {
    const m = match(req)
    const you = m.players.indexOf(req.player.id) + 1
    if (m.game !== 'puissance-4') throw new HttpError(400, 'Pas une partie de Puissance 4')
    if (m.over) throw new HttpError(409, 'Partie finie')
    if (m.turn !== you) throw new HttpError(409, 'Pas ton tour')
    const column = req.body?.column
    let line
    try {
      line = c4.drop(m.columns, column, you)
    } catch (e) {
      throw new HttpError(e.message === 'Colonne pleine' ? 409 : 400, e.message)
    }
    m.moves++
    m.last = [column, m.columns[column].length - 1]
    if (line) {
      m.line = line
      end(m, you, 'line')
    } else if (c4.full(m.columns)) {
      end(m, 3, 'draw')
    } else {
      m.turn = 3 - you
    }
    res.json(view(m, req.player.id))
  })

  // Riff Hero : où en est le joueur (son score, son combo...), `done` à la fin du morceau. Les deux
  // finis, le plus haut score gagne.
  router.post('/matches/:id/riff', (req, res) => {
    const m = match(req)
    if (m.game !== 'riff-hero') throw new HttpError(400, 'Pas une partie de Riff Hero')
    if (m.over) throw new HttpError(409, 'Partie finie')
    let p
    try {
      p = riff.progress(req.body)
    } catch (e) {
      throw new HttpError(400, e.message)
    }
    const side = m.riff[m.players.indexOf(req.player.id)]
    // Le score final ne change plus.
    if (!side.done) Object.assign(side, p)
    if (m.riff.every((s) => s.done)) end(m, riff.winner(m.riff), 'score')
    res.json(view(m, req.player.id))
  })

  router.post('/matches/:id/leave', (req, res) => {
    const m = match(req)
    if (!m.over) end(m, 2 - m.players.indexOf(req.player.id), 'forfeit')
    res.json(view(m, req.player.id))
  })

  // Un message à l'autre joueur, pendant la partie ou après.
  router.post('/matches/:id/chat', (req, res) => {
    const m = match(req)
    const text = clean(req.body?.text)
    if (!text) throw new HttpError(400, 'Message vide')
    m.chat.push({ player: req.player.id, text })
    m.chat.splice(0, Math.max(0, m.chat.length - CHAT_KEEP))
    res.json(view(m, req.player.id))
  })

  // Une revanche quand les deux la demandent : l'autre commence.
  router.post('/matches/:id/rematch', (req, res) => {
    const m = match(req)
    if (!m.over) throw new HttpError(409, 'Partie en cours')
    m.rematch[m.players.indexOf(req.player.id)] = true
    const [a, b] = m.players
    if (m.rematch[0] && m.rematch[1] && !m.next) {
      if (!online(a) || !online(b)) throw new HttpError(409, 'Joueur hors ligne')
      if (playing(a) || playing(b)) throw new HttpError(409, 'Déjà en partie')
      const next = start(b, a, m.game)
      next.chat = [...m.chat]
      m.next = next.id
    }
    res.json(view(m, req.player.id))
  })

  return router
}

module.exports = { live, ONLINE_MS, INVITE_MS, AWAY_MS }
