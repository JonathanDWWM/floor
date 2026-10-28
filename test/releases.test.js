const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { open } = require('../src/db')
const { createApp } = require('../src/app')

const TOKEN = 'secret-de-publication'
let server, base, dir

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'floor-releases-'))
  server = createApp(open(':memory:'), { releasesDir: dir, publishToken: TOKEN }).listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}/v1/ronnheim`
})
after(() => {
  server.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const put = (version, name, bytes, token = TOKEN) => fetch(`${base}/releases/${version}/${name}`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }, body: bytes })
const publish = (version, notes, token = TOKEN) => fetch(`${base}/releases/${version}/publish`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ notes }) })

test('les versions de Ronnheim : envoyées avec le jeton, publiées, téléchargées et vérifiables', async () => {
  assert.equal((await fetch(`${base}/release`)).status, 404)
  const mac = crypto.randomBytes(200000)
  // Sans le bon jeton : refusé, rien d'écrit.
  assert.equal((await put('0.2.0', 'ronnheim-aarch64-apple-darwin.tar.gz', mac, 'faux')).status, 401)
  assert.equal((await publish('0.2.0', '', 'faux')).status, 401)
  // Des noms qui sortiraient du dossier : refusés.
  assert.equal((await put('0.2.0', '..%2Fevil.tar.gz', mac)).status, 400)
  assert.equal((await put('../0', 'ronnheim-x.zip', mac)).status, 404)
  assert.equal((await publish('0.2.0', '')).status, 400)

  assert.equal((await put('0.2.0', 'ronnheim-aarch64-apple-darwin.tar.gz', mac)).status, 201)
  assert.equal((await put('0.2.0', 'ronnheim-x86_64-pc-windows-msvc.zip', Buffer.from('zip'))).status, 201)
  // Pas encore publiée : le jeu ne la voit pas.
  assert.equal((await fetch(`${base}/release`)).status, 404)
  const r = await publish('0.2.0', '- Le choix du personnage.')
  assert.equal(r.status, 201)

  const release = await (await fetch(`${base}/release`)).json()
  assert.equal(release.version, '0.2.0')
  assert.equal(release.notes, '- Le choix du personnage.')
  const file = release.files.find((f) => f.name === 'ronnheim-aarch64-apple-darwin.tar.gz')
  assert.equal(file.size, mac.length)
  assert.equal(file.sha256, crypto.createHash('sha256').update(mac).digest('hex'))
  const got = Buffer.from(await (await fetch(`${base}/download/0.2.0/${file.name}`)).arrayBuffer())
  assert.ok(got.equals(mac))
  assert.equal((await fetch(`${base}/download/0.2.0/ronnheim-nope.zip`)).status, 404)
})

test('les vieilles versions partent : les trois dernières restent', async () => {
  for (const v of ['0.3.0', '0.10.0', '0.4.0', '0.5.0']) {
    assert.equal((await put(v, 'ronnheim-x86_64-unknown-linux-gnu.tar.gz', Buffer.from(v))).status, 201)
    assert.equal((await publish(v, '')).status, 201)
  }
  const kept = fs.readdirSync(dir).filter((v) => /^\d/.test(v)).sort()
  assert.deepEqual(kept, ['0.10.0', '0.4.0', '0.5.0'])
  // La dernière publiée est celle qu'on voit (même plus petite qu'une autre gardée).
  assert.equal((await (await fetch(`${base}/release`)).json()).version, '0.5.0')
})
