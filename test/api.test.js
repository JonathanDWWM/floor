const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { open } = require('../src/db')
const { createApp } = require('../src/app')

let server, base

before(async () => {
  server = createApp(open(':memory:')).listen(0)
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

const round = (letters) => ({ letters, words: Math.round(letters / 6), wpm: Math.round(letters / 5), accuracy: 97, combo: 12 })

test('ne garde que le meilleur score de chaque joueur', async () => {
  const a = (await call('POST', '/v1/players', { body: { name: '  Ronnie   James ' } })).body
  const b = (await call('POST', '/v1/players', { body: {} })).body
  assert.equal(a.name, 'Ronnie James')
  assert.equal(b.name, null)

  let r = await call('POST', '/v1/games/speed-metal/scores', { token: a.token, body: round(300) })
  assert.equal(r.status, 201)
  assert.equal(r.body.record, true)
  r = await call('POST', '/v1/games/speed-metal/scores', { token: a.token, body: round(250) })
  assert.equal(r.status, 200)
  assert.equal(r.body.record, false)
  assert.equal(r.body.best.score, 300)
  await call('POST', '/v1/games/speed-metal/scores', { token: b.token, body: round(320) })
  await call('POST', '/v1/games/speed-metal/scores', { token: a.token, body: round(400) })

  const board = (await call('GET', '/v1/games/speed-metal/leaderboard', { token: b.token })).body
  assert.equal(board.players, 2)
  assert.deepEqual(board.entries.map((e) => [e.rank, e.name, e.score, e.me]), [[1, 'Ronnie James', 400, false], [2, null, 320, true]])
  assert.equal(board.me.rank, 2)
  assert.equal(board.entries[0].details.accuracy, 97)
})

test('renommer change le nom au classement', async () => {
  const a = (await call('POST', '/v1/players', { body: { name: 'Dio' } })).body
  await call('POST', '/v1/games/speed-metal/scores', { token: a.token, body: round(900) })
  assert.equal((await call('PATCH', '/v1/players/me', { token: a.token, body: { name: 'Holy Diver' } })).body.name, 'Holy Diver')
  const board = (await call('GET', '/v1/games/speed-metal/leaderboard?limit=1')).body
  assert.equal(board.entries[0].name, 'Holy Diver')
  assert.equal(board.me, null)
})

test('refuse les scores impossibles, les joueurs inconnus et les jeux inconnus', async () => {
  const a = (await call('POST', '/v1/players', { body: {} })).body
  assert.equal((await call('POST', '/v1/games/speed-metal/scores', { token: a.token, body: round(99999) })).status, 400)
  assert.equal((await call('POST', '/v1/games/speed-metal/scores', { token: a.token, body: { ...round(100), accuracy: 'x' } })).status, 400)
  assert.equal((await call('POST', '/v1/games/speed-metal/scores', { token: 'faux', body: round(100) })).status, 401)
  assert.equal((await call('POST', '/v1/games/tetris/scores', { token: a.token, body: round(100) })).status, 404)
  assert.equal((await call('POST', '/v1/players', { body: { name: 'x'.repeat(25) } })).status, 400)
})

test('un pseudo n’appartient qu’à un joueur', async () => {
  const a = (await call('POST', '/v1/players', { body: { name: 'Lemmy' } })).body
  assert.equal((await call('POST', '/v1/players', { body: { name: '  lemmy ' } })).status, 409)
  const b = (await call('POST', '/v1/players', { body: { name: 'Motörhead' } })).body
  assert.equal((await call('PATCH', '/v1/players/me', { token: b.token, body: { name: 'LEMMY' } })).status, 409)
  assert.equal((await call('PATCH', '/v1/players/me', { token: b.token, body: { name: 'MOTÖRHEAD' } })).status, 200)
  // Le sien, autrement écrit : gardé.
  assert.equal((await call('PATCH', '/v1/players/me', { token: a.token, body: { name: 'LEMMY' } })).body.name, 'LEMMY')
  // Libre ou pris, vu pendant qu'on le tape (le sien est libre pour soi).
  assert.deepEqual((await call('GET', '/v1/players/available?name=%20lemmy')).body, { name: 'lemmy', free: false })
  assert.equal((await call('GET', '/v1/players/available?name=LEMMY', { token: a.token })).body.free, true)
  assert.equal((await call('GET', '/v1/players/available?name=Phil')).body.free, true)
  assert.equal((await call('GET', '/v1/players/available?name=' + 'x'.repeat(25))).status, 400)
  // Libéré, il se reprend.
  await call('PATCH', '/v1/players/me', { token: a.token, body: { name: 'Ian' } })
  assert.equal((await call('POST', '/v1/players', { body: { name: 'Lemmy' } })).status, 201)
})

test('/health dit quelle version tourne', async () => {
  const { body } = await call('GET', '/health')
  assert.equal(body.ok, true)
  assert.equal(body.version, require('../package.json').version)
  assert.match(body.commit, /^[0-9a-f]{7,}$/)
  assert.ok(!Number.isNaN(Date.parse(body.started)))
})

test('donne le catalogue des modules de Ronnie', async () => {
  const { status, body } = await call('GET', '/v1/modules')
  assert.equal(status, 200)
  const serj = body.modules.find((m) => m.id === 'serj')
  assert.equal(serj.repo, 'Jellfedora/serj')
  for (const m of body.modules) {
    assert.match(m.id, /^[a-z0-9-]+$/)
    assert.ok(m.name && m.description && m.repo && m.app && m.exe)
  }
})

test('au démineur, le plus petit temps gagne', async () => {
  const a = (await call('POST', '/v1/players', { body: { name: 'Sapper' } })).body
  const b = (await call('POST', '/v1/players', { body: { name: 'Minus' } })).body
  assert.equal((await call('POST', '/v1/games/demineur/scores', { token: a.token, body: { ms: 90000, clicks: 120 } })).status, 201)
  assert.equal((await call('POST', '/v1/games/demineur/scores', { token: a.token, body: { ms: 95000, clicks: 100 } })).body.record, false)
  assert.equal((await call('POST', '/v1/games/demineur/scores', { token: a.token, body: { ms: 61000, clicks: 98 } })).body.record, true)
  await call('POST', '/v1/games/demineur/scores', { token: b.token, body: { ms: 75000, clicks: 110 } })
  assert.equal((await call('POST', '/v1/games/demineur/scores', { token: b.token, body: { ms: 200, clicks: 3 } })).status, 400)

  const board = (await call('GET', '/v1/games/demineur/leaderboard', { token: b.token })).body
  assert.deepEqual(board.entries.map((e) => [e.rank, e.name, e.score, e.me]), [[1, 'Sapper', 61000, false], [2, 'Minus', 75000, true]])
  assert.equal(board.entries[0].details.clicks, 98)
  assert.equal((await call('GET', '/v1/games')).body.find((g) => g.id === 'demineur').order, 'asc')
})

test('à Ronnie Run, la plus longue course gagne', async () => {
  const a = (await call('POST', '/v1/players', { body: { name: 'Rainbow' } })).body
  const b = (await call('POST', '/v1/players', { body: { name: 'Elf' } })).body
  assert.equal((await call('POST', '/v1/games/ronnie-run/scores', { token: a.token, body: { meters: 420, jumps: 37 } })).status, 201)
  assert.equal((await call('POST', '/v1/games/ronnie-run/scores', { token: a.token, body: { meters: 300, jumps: 25 } })).body.record, false)
  await call('POST', '/v1/games/ronnie-run/scores', { token: b.token, body: { meters: 666, jumps: 61 } })
  assert.equal((await call('POST', '/v1/games/ronnie-run/scores', { token: b.token, body: { meters: 999999, jumps: 1 } })).status, 400)

  const board = (await call('GET', '/v1/games/ronnie-run/leaderboard', { token: a.token })).body
  assert.deepEqual(board.entries.map((e) => [e.rank, e.name, e.score, e.me]), [[1, 'Elf', 666, false], [2, 'Rainbow', 420, true]])
  assert.equal(board.entries[0].details.jumps, 61)
})

test('à Backstage, le plus haut score gagne', async () => {
  const a = (await call('POST', '/v1/players', { body: { name: 'Halford' } })).body
  const b = (await call('POST', '/v1/players', { body: { name: 'Dickinson' } })).body
  assert.equal((await call('POST', '/v1/games/backstage/scores', { token: a.token, body: { score: 350, rage: 1, picks: 15 } })).status, 201)
  await call('POST', '/v1/games/backstage/scores', { token: b.token, body: { score: 1260, rage: 3, picks: 36 } })
  assert.equal((await call('POST', '/v1/games/backstage/scores', { token: b.token, body: { score: 0, rage: 0, picks: 0 } })).status, 400)

  const board = (await call('GET', '/v1/games/backstage/leaderboard', { token: a.token })).body
  assert.deepEqual(board.entries.map((e) => [e.rank, e.name, e.score, e.me]), [[1, 'Dickinson', 1260, false], [2, 'Halford', 350, true]])
  assert.equal(board.entries[0].details.rage, 3)
})

test('Riff Hero en solo : un classement par niveau', async () => {
  const a = (await call('POST', '/v1/players', { body: { name: 'Zakk' } })).body
  const song = (score) => ({ score, hits: 150, perfects: 120, misses: 12, combo: 80 })
  assert.equal((await call('POST', '/v1/games/riff-hero-difficile/scores', { token: a.token, body: song(52000) })).status, 201)
  assert.equal((await call('POST', '/v1/games/riff-hero-facile/scores', { token: a.token, body: song(21000) })).status, 201)
  const hard = (await call('GET', '/v1/games/riff-hero-difficile/leaderboard')).body
  assert.deepEqual(hard.entries.map((e) => [e.name, e.score]), [['Zakk', 52000]])
  assert.equal((await call('GET', '/v1/games/riff-hero-moyen/leaderboard')).body.players, 0)
  assert.equal((await call('POST', '/v1/games/riff-hero-moyen/scores', { token: a.token, body: song(999999) })).status, 400)
})
