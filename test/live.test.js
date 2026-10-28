const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { open } = require('../src/db')
const { createApp } = require('../src/app')
const c4 = require('../src/live/connect4')

let server, base
let clock = 1_000_000

before(async () => {
  server = createApp(open(':memory:'), { now: () => clock }).listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

async function call (method, path, { body, token } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}
const player = async (name) => (await call('POST', '/v1/players', { body: { name } })).body.token
const ping = async (token) => (await call('POST', '/v1/live/ping', { token })).body

test('les règles : 4 alignés gagnent, dans tous les sens', () => {
  const cols = c4.empty()
  for (const c of [0, 1, 2]) assert.equal(c4.drop(cols, c, 1), null)
  assert.deepEqual(c4.drop(cols, 3, 1), [[0, 0], [1, 0], [2, 0], [3, 0]])
  const diag = c4.empty()
  diag[1] = [2]; diag[2] = [2, 2]; diag[3] = [2, 2, 2]
  for (const c of [0, 1, 2]) c4.drop(diag, c, 1)
  assert.deepEqual(c4.drop(diag, 3, 1), [[0, 0], [1, 1], [2, 2], [3, 3]])
  const full = c4.empty()
  for (let r = 0; r < c4.ROWS; r++) c4.drop(full, 6, 1 + (r % 2))
  assert.throws(() => c4.drop(full, 6, 1), /pleine/)
})

test('en ligne, invitation, partie, victoire au classement, revanche', async () => {
  const dio = await player('Dio')
  const ozzy = await player('Ozzy')
  const anon = await player(null)
  assert.equal((await call('POST', '/v1/live/ping', { token: anon })).status, 403)
  await ping(ozzy)
  let p = await ping(dio)
  assert.deepEqual(p.online, [{ name: 'Ozzy', busy: false }])

  assert.equal((await call('POST', '/v1/live/invites', { token: dio, body: { to: 'Lemmy' } })).status, 404)
  const inv = (await call('POST', '/v1/live/invites', { token: dio, body: { to: 'ozzy' } })).body
  p = await ping(ozzy)
  assert.deepEqual(p.invites.map((i) => i.from), ['Dio'])
  const m = (await call('POST', `/v1/live/invites/${inv.id}/accept`, { token: ozzy })).body
  assert.deepEqual([m.players, m.you, m.turn], [['Dio', 'Ozzy'], 2, 1])
  assert.equal((await ping(dio)).sent.match, m.id)
  assert.equal((await ping(dio)).match, m.id)

  // Ozzy ne joue pas avant son tour ; Dio aligne quatre jetons en bas.
  assert.equal((await call('POST', `/v1/live/matches/${m.id}/moves`, { token: ozzy, body: { column: 0 } })).status, 409)
  let s
  for (const c of [0, 1, 2]) {
    await call('POST', `/v1/live/matches/${m.id}/moves`, { token: dio, body: { column: c } })
    await call('POST', `/v1/live/matches/${m.id}/moves`, { token: ozzy, body: { column: c } })
  }
  s = (await call('POST', `/v1/live/matches/${m.id}/moves`, { token: dio, body: { column: 3 } })).body
  assert.deepEqual([s.over, s.winner, s.reason, s.line.length], [true, 1, 'line', 4])
  const board = (await call('GET', '/v1/games/puissance-4/leaderboard')).body
  assert.deepEqual(board.entries.map((e) => [e.name, e.score]), [['Dio', 1]])
  assert.equal((await call('POST', '/v1/games/puissance-4/scores', { token: dio, body: {} })).status, 403)

  // Le chat : nettoyé, vu des deux, et il suit dans la revanche.
  assert.equal((await call('POST', `/v1/live/matches/${m.id}/chat`, { token: ozzy, body: { text: '  \n ' } })).status, 400)
  s = (await call('POST', `/v1/live/matches/${m.id}/chat`, { token: ozzy, body: { text: 'bien\njoué ' + 'x'.repeat(300) } })).body
  assert.deepEqual(s.chat.map(([n, text, mine]) => [n, text.length, mine]), [['Ozzy', 200, true]])
  assert.ok(s.chat[0][1].startsWith('bien joué'))
  await call('POST', `/v1/live/matches/${m.id}/chat`, { token: dio, body: { text: 'merci' } })
  assert.deepEqual((await call('GET', `/v1/live/matches/${m.id}`, { token: dio })).body.chat.map(([n, , mine]) => [n, mine]), [['Ozzy', false], ['Dio', true]])

  await call('POST', `/v1/live/matches/${m.id}/rematch`, { token: dio })
  s = (await call('POST', `/v1/live/matches/${m.id}/rematch`, { token: ozzy })).body
  const next = (await call('GET', `/v1/live/matches/${s.next}`, { token: ozzy })).body
  assert.deepEqual([next.players, next.you], [['Ozzy', 'Dio'], 1])
  assert.deepEqual(next.chat.map(([n, text]) => [n, text]).slice(1), [['Dio', 'merci']])
  await call('POST', `/v1/live/matches/${next.id}/leave`, { token: dio })
  assert.equal((await ping(ozzy)).match, null)
})

test('hors ligne et absents : invitation périmée, partie perdue par forfait', async () => {
  const a = await player('Ronnie')
  const b = await player('Tony')
  await ping(b)
  await ping(a)
  const inv = (await call('POST', '/v1/live/invites', { token: a, body: { to: 'Tony' } })).body
  clock += 61 * 1000
  assert.equal((await ping(a)).sent.status, 'expired')
  assert.equal((await call('POST', `/v1/live/invites/${inv.id}/accept`, { token: b })).status, 409)
  // Plus vu depuis 25 s : hors ligne.
  assert.equal((await call('POST', '/v1/live/invites', { token: a, body: { to: 'Tony' } })).status, 201)
  clock += 26 * 1000
  await ping(a)
  assert.equal((await call('POST', '/v1/live/invites', { token: a, body: { to: 'Tony' } })).status, 404)

  await ping(b)
  const inv2 = (await call('POST', '/v1/live/invites', { token: a, body: { to: 'Tony' } })).body
  const m = (await call('POST', `/v1/live/invites/${inv2.id}/accept`, { token: b })).body
  clock += 46 * 1000
  const s = (await call('GET', `/v1/live/matches/${m.id}`, { token: a })).body
  assert.deepEqual([s.over, s.winner, s.reason], [true, 1, 'forfeit'])
})

test('une invitation à Ronnie.io : acceptée, sans partie à deux', async () => {
  const lemmy = await player('Lemmy')
  const lita = await player('Lita')
  await ping(lemmy)
  await ping(lita)
  assert.equal((await call('POST', '/v1/live/invites', { token: lemmy, body: { to: 'Lita', game: 'pong' } })).status, 400)
  const sent = await call('POST', '/v1/live/invites', { token: lemmy, body: { to: 'Lita', game: 'ronnie-io' } })
  assert.equal(sent.status, 201)
  const received = (await ping(lita)).invites
  assert.deepEqual(received.map((i) => [i.from, i.game]), [['Lemmy', 'ronnie-io']])
  const accepted = await call('POST', `/v1/live/invites/${received[0].id}/accept`, { token: lita })
  assert.deepEqual([accepted.status, accepted.body], [201, { game: 'ronnie-io' }])
  const mine = (await ping(lemmy)).sent
  assert.deepEqual([mine.status, mine.game, mine.match], ['accepted', 'ronnie-io', null])
})

test('un battle de Riff Hero : le même morceau, les scores, le plus haut gagne', async () => {
  const kirk = await player('Kirk')
  const slash = await player('Slash')
  await ping(kirk)
  await ping(slash)
  const inv = (await call('POST', '/v1/live/invites', { token: kirk, body: { to: 'Slash', game: 'riff-hero' } })).body
  assert.deepEqual((await ping(slash)).invites.map((i) => i.game), ['riff-hero'])
  const m = (await call('POST', `/v1/live/invites/${inv.id}/accept`, { token: slash })).body
  assert.equal(m.game, 'riff-hero')
  assert.ok(Number.isInteger(m.seed) && m.seed > 0)
  assert.equal(m.starts_in, 5000)
  assert.deepEqual(m.riff.map((s) => s.score), [0, 0])
  assert.equal((await ping(kirk)).match, m.id)
  // Pas de jeton de Puissance 4 dans un battle, pas de score impossible.
  assert.equal((await call('POST', `/v1/live/matches/${m.id}/moves`, { token: kirk, body: { column: 0 } })).status, 400)
  assert.equal((await call('POST', `/v1/live/matches/${m.id}/riff`, { token: kirk, body: { score: -1, combo: 0, hits: 0, misses: 0 } })).status, 400)

  const riff = (token, score, done = false) => call('POST', `/v1/live/matches/${m.id}/riff`, { token, body: { score, combo: 3, hits: 10, misses: 1, done } })
  let s = (await riff(kirk, 1200)).body
  assert.deepEqual([s.riff[0].score, s.over], [1200, false])
  // Le même départ pour les deux, et chacun voit l'autre.
  const seen = (await call('GET', `/v1/live/matches/${m.id}`, { token: slash })).body
  assert.deepEqual([seen.seed, seen.riff[0].score, seen.you], [m.seed, 1200, 2])
  await riff(kirk, 5000, true)
  // Fini : le score ne bouge plus.
  assert.equal((await riff(kirk, 9999)).body.riff[0].score, 5000)
  s = (await riff(slash, 7000, true)).body
  assert.deepEqual([s.over, s.winner, s.reason], [true, 2, 'score'])
  const board = (await call('GET', '/v1/games/riff-hero/leaderboard')).body
  assert.deepEqual(board.entries.map((e) => [e.name, e.score]), [['Slash', 1]])

  // La revanche : un nouveau morceau, l'autre en premier.
  await call('POST', `/v1/live/matches/${m.id}/rematch`, { token: kirk })
  s = (await call('POST', `/v1/live/matches/${m.id}/rematch`, { token: slash })).body
  const next = (await call('GET', `/v1/live/matches/${s.next}`, { token: slash })).body
  assert.deepEqual([next.game, next.you, next.riff[1].score], ['riff-hero', 1, 0])

  // Sans score final de l'un, le battle se termine quand même après le morceau.
  await call('POST', `/v1/live/matches/${next.id}/riff`, { token: slash, body: { score: 300, combo: 0, hits: 3, misses: 0, done: true } })
  for (let k = 0; k < 4; k++) {
    clock += 20 * 1000
    await ping(slash)
    await ping(kirk)
  }
  const late = (await call('GET', `/v1/live/matches/${next.id}`, { token: kirk })).body
  assert.deepEqual([late.over, late.winner, late.reason], [true, 1, 'score'])
})
