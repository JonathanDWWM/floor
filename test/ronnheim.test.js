const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const WebSocket = require('ws')
const { open } = require('../src/db')
const { createApp } = require('../src/app')
const { blob } = require('../src/blob')
const { ronnheim } = require('../src/ronnheim')
const dungeon = require('../src/ronnheim/crypt')
const { World, ISLANDS, DAY, NIGHT, RAIN, DRY, CRYPT, SPIKES, SPAWNER, STARS, COMBAT, SPEAR, SHIELDED, SIZE, GROW, BOAT, BEASTS, BASE_HP, CHEST_KINDS, SHIELDS, PARRY, STUN_TIME, SIDE, TILE, T, terrain, seeded } = require('../src/ronnheim/world')

// Un monde sans bêtes ni rien par terre, pour poser chaque scène à la main.
function bare (seed = 1) {
  const world = new World({ seed, random: seeded(7) })
  world.beasts.clear()
  world.items.clear()
  world.changes()
  world.litterAt = Infinity
  world.beastsAt = Infinity
  return world
}

// Un établi posé à côté du joueur (le bois en plus).
// Le joueur juste devant une pièce (on ne s'en sert que collé à elle).
function front (p, piece) {
  Object.assign(p, { x: piece.x, y: piece.y + 6 })
}

function bench (world, p) {
  p.inv.hammer = 1
  p.held = 'hammer'
  p.inv.wood = (p.inv.wood ?? 0) + 10
  // Collé au joueur (on ne se sert d'un poste que tout contre lui).
  for (const [dx, dy] of [-6, -10, -14, -18, 6, 10, 14, 18].map((dy) => [0, dy]).concat([-22, 22].flatMap((dx) => [0, 4, 8, 12, 16].map((dy) => [dx, dy])))) {
    p.inv.hammer = 1
    p.held = 'hammer'
    if (world.place(p.id, 'workbench', p.x + dx, p.y + dy) !== null) continue
    const piece = [...world.pieces.values()].find((x) => x.kind === 'workbench')
    if (world.touching(p, piece)) return piece
    world.unbuild(p.id, piece.id)
  }
  throw new Error('pas de place pour l’établi')
}

const run = (world, seconds) => {
  for (let k = 0; k < seconds * 20; k++) world.step(0.05)
}

test('l’île : la même pour une graine, de l’eau sur les bords, le départ au sec et dégagé', () => {
  const a = terrain(seeded(3))
  assert.equal(a.tiles, terrain(seeded(3)).tiles)
  assert.notEqual(a.tiles, terrain(seeded(4)).tiles)
  assert.equal(a.tiles.length, SIDE * SIDE)
  assert.equal(a.tiles[0], T.deep)
  const world = new World({ seed: 3, random: seeded(1) })
  assert.ok(world.walkable(world.spawn.x, world.spawn.y))
  assert.ok(world.trees.size > 300, `${world.trees.size} arbres`)
  assert.ok(world.rocks.size > 20)
  assert.ok([...world.items.values()].some((i) => i.kind === 'branch'))
  // Les bêtes suivent la terre qu'il y a (plus les gardes des mausolées).
  const wanted = (biome, k) => Math.round(k * world.scale)
  assert.equal(world.beasts.size, Object.values(BEASTS).reduce((n, b) => n + Object.entries(b.count).reduce((a, [biome, k]) => a + wanted(biome, k), 0), 0) + world.crypts.length * CRYPT.guards)
  // Un monde d'îles : plusieurs, la première au milieu (le départ), de la mer entre.
  assert.ok(world.islands.length >= ISLANDS.count[0])
  assert.ok(world.scale > 3, `${world.scale}`)
  // Pas de bouleau dans la forêt noire, des pins.
  assert.ok([...world.trees.values()].filter((t) => t.kind === 'birch').every((t) => !world.wild(t.x, t.y)))
  assert.ok([...world.trees.values()].some((t) => t.kind === 'pine' && world.wild(t.x, t.y)))
  assert.ok([...world.beasts.values()].some((b) => b.kind === 'skeleton' && b.home === 'forest'))
  // Les arbres ont les mêmes ids d'une fois à l'autre (les souches gardées s'y retrouvent).
  const again = new World({ seed: 3, random: seeded(9) })
  assert.deepEqual([...again.trees.values()].slice(0, 5).map((t) => [t.id, t.x, t.y]), [...world.trees.values()].slice(0, 5).map((t) => [t.id, t.x, t.y]))
})

test('ramasser, fabriquer une hache, abattre un arbre', () => {
  const world = bare()
  const p = world.join('Dio')
  const { x, y } = world.spawn
  const branch = world.drop('branch', 1, x + 10, y)
  assert.ok(world.pick(p.id, branch.id))
  assert.deepEqual(p.inv, { wood: 1 })
  // Trop loin : rien.
  const far = world.drop('stone', 1, x + 200, y)
  assert.ok(!world.pick(p.id, far.id))
  assert.equal(world.craft(p.id, 'axe'), 'need')
  Object.assign(p.inv, { wood: 5, stone: 4 })
  assert.equal(world.craft(p.id, 'axe'), null)
  assert.deepEqual(p.inv, { axe: 1 })
  // Un hêtre juste à droite du joueur, tourné vers lui.
  const tree = [...world.trees.values()].find((t) => t.kind === 'beech')
  Object.assign(p, { x: tree.x - 16, y: tree.y + 2, d: 3 })
  world.hit(p.id)
  assert.deepEqual(world.drain().filter((n) => n.t === 'fx').map((n) => n.k), ['nochop'])
  run(world, 0.5)
  world.hold(p.id, 'axe')
  for (let k = 0; k < 6; k++) {
    world.hit(p.id)
    run(world, 0.7)
  }
  assert.ok(tree.stump)
  const news = world.drain().filter((n) => n.t === 'fx').map((n) => n.k)
  assert.equal(news.filter((k) => k === 'chop').length, 6)
  assert.ok(news.includes('fell'))
  const wood = [...world.items.values()].filter((i) => i.kind === 'wood')
  assert.equal(wood.length, 4)
  // Tombé du côté opposé au bûcheron.
  assert.ok(wood.every((i) => i.x > tree.x))
  assert.deepEqual(world.changes().trees.map((t) => t.id), [tree.id])
  // Il ne repousse pas ; la souche s'arrache à la hache, pour de bon (une bûche).
  run(world, 30 * 60)
  assert.ok(tree.stump)
  world.drain()
  for (let k = 0; k < 3; k++) {
    world.hit(p.id)
    run(world, 0.7)
  }
  assert.ok(!world.trees.has(tree.id))
  assert.ok(world.drain().some((n) => n.k === 'uproot'))
  assert.ok(world.changes().gone.includes(tree.id))
  const back = bare()
  back.restore(JSON.parse(JSON.stringify(world.snapshot())))
  assert.ok(!back.trees.has(tree.id))
})

test('la chasse : le cerf fuit qui court, une flèche le blesse, deux le tuent ; le butin tombe', () => {
  const world = bare()
  const p = world.join('Dio')
  Object.assign(p.inv, { bow: 1, arrow: 3 })
  world.hold(p.id, 'bow')
  // Rien entre le chasseur et le cerf.
  for (const t of [...world.trees.values()]) {
    if (Math.hypot(t.x - p.x, t.y - p.y) < 160) {
      world.trees.delete(t.id)
      world.grid.trees.delete(t)
    }
  }
  const deer = { id: world.nextId++, kind: 'deer', x: p.x + 100, y: p.y, hp: 40, d: 2, state: 'graze', until: 99, vx: 0, vy: 0, target: null, flee: null, bit: 0, hurt: -99 }
  world.beasts.set(deer.id, deer)
  // À pas de loup : il broute.
  p.m = 1
  run(world, 0.2)
  assert.equal(deer.state, 'graze')
  world.shoot(p.id, 0)
  run(world, 0.5)
  assert.equal(deer.hp, 18)
  assert.equal(deer.state, 'flee')
  assert.equal(p.inv.arrow, 2)
  // Un tir trop tôt est ignoré.
  run(world, 0.25)
  world.shoot(p.id, 0)
  world.shoot(p.id, 0)
  assert.equal(p.inv.arrow, 1)
  // Le cerf a filé : on le ramène devant le joueur, et on tire encore.
  run(world, 1)
  Object.assign(deer, { x: p.x + 60, y: p.y, state: 'graze', until: world.time + 99 })
  world.shoot(p.id, 0)
  run(world, 0.5)
  assert.ok(!world.beasts.has(deer.id))
  const loot = [...world.items.values()].map((i) => i.kind)
  assert.ok(loot.includes('meat') && loot.includes('hide'))
  assert.ok(world.drain().some((n) => n.t === 'fx' && n.k === 'die'))
  // Sans flèches, l'arc ne tire plus.
  p.inv.arrow = 0
  delete p.inv.arrow
  p.ready = 0
  const flying = world.arrows.length
  world.shoot(p.id, 0)
  assert.equal(world.arrows.length, flying)
})

test("l'arc tire les flèches en silex d'abord : elles font plus mal", () => {
  const world = bare()
  const p = world.join('Dio')
  Object.assign(p.inv, { bow: 1, arrow: 2, flintarrow: 1 })
  world.hold(p.id, 'bow')
  world.shoot(p.id, 0)
  assert.equal(world.arrows.at(-1).dmg, 28)
  assert.equal(p.inv.flintarrow, undefined)
  p.ready = 0
  world.shoot(p.id, 0)
  assert.equal(world.arrows.at(-1).dmg, 22)
  assert.equal(p.inv.arrow, 1)
})

test('le cerf entend qui court près de lui ; le sanglier blessé charge et mord', () => {
  const world = bare()
  const p = world.join('Dio')
  const deer = { id: world.nextId++, kind: 'deer', x: p.x + 90, y: p.y, hp: 40, d: 2, state: 'graze', until: 99, vx: 0, vy: 0, target: null, flee: null, bit: 0, hurt: -99 }
  world.beasts.set(deer.id, deer)
  p.m = 2
  run(world, 0.1)
  assert.equal(deer.state, 'flee')
  world.beasts.clear()

  const boar = { id: world.nextId++, kind: 'boar', x: p.x + 24, y: p.y + 8, hp: 50, d: 2, state: 'idle', until: 99, vx: 0, vy: 0, target: null, flee: null, bit: 0, hurt: -99 }
  world.beasts.set(boar.id, boar)
  Object.assign(p, { d: 3, m: 0 })
  world.hit(p.id)
  assert.equal(boar.hp, 44)
  assert.equal(boar.state, 'rage')
  run(world, 3)
  assert.ok(p.hp < BASE_HP - 5, `santé ${p.hp}`)
  // Mordu jusqu'au bout : mort, puis de retour au départ.
  run(world, 30)
  assert.ok(!p.alive || boar.state !== 'rage')
  p.hp = 1
  p.alive = true
  boar.state = 'rage'
  boar.target = p.id
  boar.until = world.time + 9
  boar.bit = -99
  Object.assign(boar, { x: p.x + 5, y: p.y })
  // Il lève d'abord la tête : le coup tombe un instant plus tard.
  run(world, 0.2)
  assert.ok(p.alive && boar.swing)
  run(world, 0.3)
  assert.ok(!p.alive)
  assert.ok(world.drain().some((n) => n.t === 'dead'))
  world.respawn(p.id)
  assert.ok(p.alive)
  assert.deepEqual([p.x, p.y, p.hp], [world.spawn.x, world.spawn.y, BASE_HP])
})

test('le feu de camp : posé, il cuit la viande, qu’on mange ; il s’éteint, une bûche le rallume', () => {
  const world = bare()
  const p = world.join('Dio')
  const { x, y } = world.spawn
  Object.assign(p.inv, { stone: 5, wood: 3, meat: 3 })
  // Sans marteau, rien ; trop loin, rien.
  assert.ok(!world.build(p.id, x + 30, y))
  p.inv.hammer = 1
  p.held = 'hammer'
  assert.ok(!world.build(p.id, x + 200, y))
  assert.ok(world.build(p.id, x + 30, y))
  assert.deepEqual(p.inv, { hammer: 1, wood: 1, meat: 3 })
  const fire = [...world.fires.values()][0]
  // Pas à même le feu : sur un poste de cuisson posé dessus (il faut un établi).
  assert.ok(!world.cook(p.id, fire.id))
  world.addPiece('workbench', Math.floor(fire.x / TILE) - 6, Math.floor(fire.y / TILE) - 4)
  p.inv.wood += 2
  assert.equal(world.place(p.id, 'cookingstation', x + 60, y + 60), 'fire')
  assert.equal(world.place(p.id, 'cookingstation', fire.x + 2, fire.y - 2), null)
  assert.equal(world.place(p.id, 'cauldron', fire.x, fire.y), 'need')
  p.inv.tin = 10
  assert.equal(world.place(p.id, 'cauldron', fire.x, fire.y), 'blocked')
  delete p.inv.tin
  assert.ok(world.spitOn(fire))
  assert.ok(world.cook(p.id, fire.id))
  assert.ok(world.cook(p.id, fire.id))
  // Deux à la fois au plus.
  assert.ok(!world.cook(p.id, fire.id))
  run(world, 6.1)
  const cooked = [...world.items.values()].filter((i) => i.kind === 'cooked')
  assert.equal(cooked.length, 2)
  for (const c of cooked) {
    Object.assign(p, { x: c.x - 5, y: c.y })
    assert.ok(world.pick(p.id, c.id))
  }
  // Un repas : la vie monte, et son maximum tant qu'il dure ; pas deux fois le même, pas de viande crue.
  p.hp = 20
  assert.equal(world.eat(p.id, 'cooked'), null)
  assert.deepEqual([world.maxHp(p), p.hp], [BASE_HP + 30, 50])
  assert.equal(world.eat(p.id, 'cooked'), 'same')
  assert.equal(world.eat(p.id, 'meat'), 'none')
  // Il s'éteint : plus de cuisson, puis une bûche.
  run(world, 180)
  assert.equal(fire.fuel, 0)
  Object.assign(p, { x: fire.x - 20, y: fire.y })
  assert.ok(!world.cook(p.id, fire.id))
  assert.ok(world.fuel(p.id, fire.id))
  assert.equal(fire.fuel, 90)
  // On ne marche pas dans le feu.
  assert.ok(!world.walkable(fire.x + 2, fire.y))
})

test('bouger : trop vite, refusé ; dans l’eau, on nage ; ce qui dure se garde et revient', () => {
  const world = bare()
  const p = world.join('Dio')
  run(world, 0.1)
  assert.ok(world.move(p.id, p.x + 6, p.y, 3, 1))
  run(world, 0.1)
  assert.ok(!world.move(p.id, p.x + 200, p.y, 3, 1))
  let wet = null
  for (let k = 0; k < SIDE * SIDE && !wet; k++) {
    if (world.tiles[k] === T.water) wet = { x: (k % SIDE) * TILE + 8, y: Math.floor(k / SIDE) * TILE + 8 }
  }
  Object.assign(p, { x: wet.x - 4, y: wet.y })
  run(world, 0.1)
  assert.ok(world.move(p.id, wet.x, wet.y, 3, 1))
  assert.ok(world.wadeable(p.x, p.y))
  Object.assign(p, { x: world.spawn.x, y: world.spawn.y })

  const tree = [...world.trees.values()][3]
  tree.stump = true
  Object.assign(p.inv, { stone: 5, wood: 2 })
  Object.assign(p, { x: world.spawn.x, y: world.spawn.y })
  p.inv.hammer = 1
  p.held = 'hammer'
  world.build(p.id, world.spawn.x + 30, world.spawn.y)
  const back = bare()
  back.restore(JSON.parse(JSON.stringify(world.snapshot())))
  assert.ok(back.trees.get(tree.id).stump)
  assert.equal(back.fires.size, 1)
  // L'inventaire rangé : nettoyé (pas deux fois la même chose, pas n'importe quoi), et gardé.
  world.arrange(p.id, [null, 'wood', 'wood', 42, 'x'.repeat(40), 'stone'])
  assert.deepEqual(p.order, [null, 'wood', null, null, null, 'stone'])
  world.arrange(p.id, 'nope')
  assert.deepEqual(p.order, [null, 'wood', null, null, null, 'stone'])
  const saved = world.save(p)
  const again = back.join('Dio', { saved })
  assert.deepEqual(again.order, p.order)
  assert.deepEqual([again.x, again.y, again.hp], [saved.x, saved.y, saved.hp])
})

let db, app, server, url, game

before(async () => {
  db = open(':memory:')
  app = createApp(db)
  server = app.listen(0)
  // Les deux jeux sur le même serveur, chacun son chemin.
  blob(server, db, app.locals.players)
  game = ronnheim(server, db, app.locals.players)
  await new Promise((resolve) => server.once('listening', resolve))
  url = `127.0.0.1:${server.address().port}`
})
after(() => {
  server.closeAllConnections()
  server.close()
})

function connect (path = '/v1/ronnheim/ws') {
  const ws = new WebSocket(`ws://${url}${path}`)
  const queue = []
  const waiting = []
  ws.on('message', (data) => {
    const msg = JSON.parse(data)
    const k = waiting.findIndex((w) => w.type === msg.t)
    if (k >= 0) waiting.splice(k, 1)[0].resolve(msg)
    else queue.push(msg)
  })
  const next = (type) => {
    const k = queue.findIndex((m) => m.t === type)
    if (k >= 0) return Promise.resolve(queue.splice(k, 1)[0])
    return new Promise((resolve) => waiting.push({ type, resolve }))
  }
  const say = (msg) => ws.send(JSON.stringify(msg))
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve({ ws, next, say, queue }))
    ws.on('error', reject)
  })
}

async function account (name) {
  const res = await fetch(`http://${url}/v1/players`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
  return (await res.json()).token
}

test('en ligne : on entre, on voit l’île et les autres, on ramasse ; Ronnie.io marche toujours à côté', { timeout: 15000 }, async () => {
  const anon = await connect()
  anon.say({ t: 'hello', token: await account(null) })
  assert.match((await anon.next('error')).error, /pseudo/)

  const dio = await connect()
  dio.say({ t: 'hello', token: await account('Dio') })
  const welcome = await dio.next('welcome')
  // La carte serrée (une lettre par sorte de case, puis la longueur de la suite) : toute la carte.
  const runs = [...welcome.tiles.matchAll(/([a-j])(\d*)/g)]
  assert.equal(runs.reduce((n, [, , k]) => n + (k ? Number(k) : 1), 0), SIDE * SIDE)
  assert.equal(runs.map(([, c, k]) => String.fromCharCode(c.charCodeAt(0) - 49).repeat(k ? Number(k) : 1)).join(''), game.world.tiles)
  assert.ok(welcome.recipes.some((r) => r.id === 'axe'))
  assert.ok(welcome.altar.x > 0)
  // Le décor arrive ensuite, par zones : autour de soi.
  const scenery = await dio.next('r')
  assert.ok(scenery.trees.length > 100)
  const me = await dio.next('me')
  assert.deepEqual(me.inv, {})
  const ozzy = await connect()
  ozzy.say({ t: 'hello', token: await account('Ozzy') })
  await ozzy.next('welcome')
  // Dio voit Ozzy (au départ, tout près), avec son nom.
  let frame
  do frame = await dio.next('s')
  while (!Object.values(frame.n).includes('Ozzy') && !dio.seen?.includes('Ozzy'))
  assert.equal(frame.p.length / 12, 2)

  // Une branche posée à ses pieds : ramassée, c'est du bois.
  const p = game.world.players.get(welcome.you)
  const branch = game.world.drop('branch', 1, p.x + 8, p.y)
  await dio.next('o')
  dio.say({ t: 'pick', id: branch.id })
  assert.deepEqual(await dio.next('got'), { t: 'got', kind: 'wood', n: 1 })
  assert.deepEqual((await dio.next('me')).inv, { wood: 1 })
  // Trop loin d'un coup : remis à sa place.
  dio.say({ t: 'pos', x: p.x + 500, y: p.y, d: 3, m: 2 })
  const back = await dio.next('pos')
  assert.deepEqual([back.x, back.y], [Math.round(p.x), Math.round(p.y)])

  // Ronnie.io, sur le même serveur, répond toujours ; un autre chemin est refusé.
  const io = await connect('/v1/blob/ws')
  io.say({ t: 'hello', token: await account('Lemmy'), aspect: 1.6 })
  assert.equal((await io.next('welcome')).t, 'welcome')
  await assert.rejects(connect('/v1/nope/ws'))

  // La pause : à deux, le monde continue ; seul, il attend.
  dio.say({ t: 'pause', on: true })
  do frame = await dio.next('s')
  while (frame.pz[1])
  assert.deepEqual(frame.pz, [0, 0])
  ozzy.ws.close()
  do frame = await dio.next('s')
  while (!frame.pz[1])
  assert.deepEqual(frame.pz, [1, 1])
  const paused = game.world.time
  await dio.next('s')
  assert.equal(game.world.time, paused)
  dio.say({ t: 'pause', on: false })
  do frame = await dio.next('s')
  while (frame.pz[1])
  await dio.next('s')
  assert.ok(game.world.time > paused)
  for (const c of [anon, dio, io]) c.ws.close()
})

test('la cueillette et les repas : trois à la fois, ils s’épuisent ; le silex sur le sable, les champignons sous les arbres', () => {
  const world = new World({ seed: 1, random: seeded(7) })
  // Pas de griset pour venir mordre pendant qu'on attend.
  world.beasts.clear()
  world.beastsAt = Infinity
  const flint = [...world.items.values()].filter((i) => i.kind === 'flint')
  assert.ok(flint.length > 20 && flint.every((i) => world.tile(i.x, i.y) === T.sand))
  const shrooms = [...world.items.values()].filter((i) => i.kind === 'mushroom')
  assert.ok(shrooms.length > 20 && shrooms.every((i) => [...world.trees.values()].some((t) => Math.hypot(t.x - i.x, t.y - i.y) < 45)))
  const p = world.join('Dio')
  const bush = [...world.bushes.values()][0]
  Object.assign(p, { x: bush.x + 10, y: bush.y })
  assert.ok(world.gather(p.id, bush.id))
  assert.ok(p.inv.raspberry >= 2)
  assert.ok(!world.gather(p.id, bush.id))
  assert.deepEqual(world.changes().bushes.map((b) => b.id), [bush.id])
  Object.assign(p.inv, { raspberry: 2, mushroom: 1, cooked: 1 })
  for (const k of ['raspberry', 'mushroom', 'cooked']) assert.equal(world.eat(p.id, k), null)
  assert.equal(world.maxHp(p), BASE_HP + 7 + 15 + 30)
  assert.equal(world.maxStamina(p), 50 + 20 + 15 + 10)
  // Le ventre plein : un quatrième repas attend ; les framboises se reprennent presque finies.
  p.inv.cooked = 1
  world.food = null
  run(world, 1)
  assert.equal(world.eat(p.id, 'raspberry'), 'same')
  for (let k = 0; k < 600 * 0.75; k++) world.step(1)
  assert.equal(world.eat(p.id, 'raspberry'), null)
  // Les repas finissent, et le maximum redescend ; les framboises repoussent, en 50 minutes.
  assert.ok(!bush.ripe)
  for (let k = 0; k < 1300; k++) world.step(1)
  assert.deepEqual([p.food.length, world.maxHp(p)], [0, BASE_HP])
  assert.ok(p.hp <= BASE_HP)
  for (let k = 0; k < 50 * 60; k++) world.step(1)
  assert.ok(bush.ripe)
})

test('les vêtements retiennent les coups ; la pioche casse les rochers, qui reviennent', () => {
  const world = bare()
  const p = world.join('Dio')
  Object.assign(p.inv, { bronzeplate: 1, ragpants: 1, leather: 5 })
  world.wear(p.id, 'bronzeplate')
  world.wear(p.id, 'ragpants')
  assert.equal(world.armor(p), 9)
  world.wear(p.id, 'ragpants')
  assert.equal(world.armor(p), 8)
  // Une armure forte face au coup le réduit au carré (9² / (4 × 8) ≈ 3).
  world.damage(p, 9)
  assert.equal(p.hp, BASE_HP - 3)
  world.damage(p, 12)
  assert.equal(p.hp, BASE_HP - 8)
  // Fabriqués à l'établi : dans l'inventaire, à mettre soi-même.
  assert.equal(world.craft(p.id, 'ragtunic'), 'workbench')
  bench(world, p)
  assert.equal(world.craft(p.id, 'ragtunic'), null)
  assert.equal(p.inv.ragtunic, 1)

  const rock = [...world.rocks.values()][0]
  Object.assign(p, { x: rock.x - 22, y: rock.y + 1, d: 3, hp: 40 })
  world.hit(p.id)
  assert.ok(world.drain().some((n) => n.k === 'nomine'))
  Object.assign(p.inv, { pickaxe: 1 })
  world.hold(p.id, 'pickaxe')
  for (let k = 0; k < 8; k++) {
    p.ready = 0
    world.hit(p.id)
  }
  assert.ok(rock.gone)
  assert.ok(world.walkable(rock.x, rock.y))
  const loot = [...world.items.values()].map((i) => i.kind)
  assert.deepEqual([loot.filter((k) => k === 'stone').length, loot.filter((k) => k === 'flint').length], [5, 2])
  for (let k = 0; k < 15 * 60 + 2; k++) world.step(1)
  Object.assign(p, { x: world.spawn.x, y: world.spawn.y })
  world.step(1)
  assert.ok(!rock.gone)
})

test('Eikthyr : deux bois de cerf sur l’autel, il arrive, frappe, foudroie ; vaincu, il laisse son bois dur', () => {
  const world = bare()
  const p = world.join('Dio')
  const { altar } = world
  assert.ok(Math.hypot(altar.x - world.spawn.x, altar.y - world.spawn.y) > 100)
  assert.equal(world.offer(p.id), 'far')
  Object.assign(p, { x: altar.x, y: altar.y + 30 })
  assert.equal(world.offer(p.id), 'need')
  p.inv.antler = 3
  assert.equal(world.offer(p.id), null)
  assert.equal(p.inv.antler, 1)
  assert.ok(world.drain().some((n) => n.t === 'boss' && n.on))
  run(world, 3)
  const boss = world.boss()
  assert.ok(boss && boss.max === 500)
  assert.equal(world.offer(p.id), 'busy')
  // Il vient au contact et frappe ; ses éclairs tombent où l'on était (un joueur qui tient le coup).
  world.maxHp = () => 1000
  Object.assign(p, { hp: 1000, food: [] })
  run(world, 8)
  const hits = world.drain().filter((n) => n.t === 'fx').map((n) => n.k)
  assert.ok(hits.includes('stomp') || hits.includes('charge'), hits.join())
  assert.ok(hits.includes('bolt'))
  assert.ok(p.hp < 1000)
  // On le tue : son butin.
  Object.assign(p, { held: 'spear', hp: 1000, d: boss.x < p.x ? 2 : 3 })
  p.inv.spear = 1
  for (let k = 0; k < 200 && world.boss(); k++) {
    Object.assign(p, { x: boss.x + (p.d === 2 ? 24 : -24), y: boss.y, ready: 0, hp: 1000, alive: true })
    world.hit(p.id)
    world.step(0.05)
  }
  assert.equal(world.boss(), null)
  const loot = [...world.items.values()].map((i) => i.kind)
  assert.ok(loot.includes('hardantler') && loot.includes('trophy'))
  assert.ok(world.drain().some((n) => n.t === 'boss' && n.killed))
  // Le bois dur fait la pioche.
  Object.assign(p.inv, { hardantler: 3, wood: 10 })
  Object.assign(p, { x: world.spawn.x, y: world.spawn.y })
  bench(world, p)
  assert.equal(world.craft(p.id, 'pickaxe'), null)

  // Personne pour l'affronter : il repart.
  p.inv.antler = 2
  Object.assign(p, { x: altar.x, y: altar.y + 30 })
  world.offer(p.id)
  run(world, 3)
  assert.ok(world.boss())
  Object.assign(p, { x: world.spawn.x, y: world.spawn.y + 900 })
  run(world, 30)
  assert.equal(world.boss(), null)
  assert.ok(world.drain().some((n) => n.t === 'boss' && !n.on && !n.killed))
})

test('la forêt noire : autour de la prairie, des sapins, des myrtilles, du cuivre, des nains gris ; les grisets dans la prairie', () => {
  const world = new World({ seed: 3, random: seeded(1) })
  const { spawn } = world
  assert.ok(!world.wild(spawn.x, spawn.y))
  const firs = [...world.trees.values()].filter((t) => t.kind === 'fir')
  assert.ok(firs.length > 1000, `${firs.length} sapins`)
  assert.ok(firs.filter((t) => world.wild(t.x, t.y)).length > firs.length * 0.98)
  assert.ok([...world.bushes.values()].some((b) => b.kind === 'blueberry' && world.wild(b.x, b.y)))
  assert.ok([...world.rocks.values()].filter((k) => k.kind === 'copper').every((k) => world.wild(k.x, k.y)))
  const beasts = [...world.beasts.values()]
  assert.ok(beasts.filter((b) => b.kind === 'greydwarf' || b.kind === 'troll').every((b) => world.wild(b.x, b.y)))
  assert.ok(beasts.filter((b) => b.kind === 'greyling' || b.kind === 'deer').every((b) => !world.wild(b.x, b.y)))
  assert.ok([...world.items.values()].filter((i) => i.kind === 'wildcarrot').every((i) => world.tile(i.x, i.y) === T.forest))
  // L'étain : des gisements au bord de l'eau, dans la forêt noire.
  const tins = [...world.rocks.values()].filter((k) => k.kind === 'tin')
  assert.ok(tins.length > 5, `${tins.length} gisements d'étain`)
  assert.ok(tins.every((k) => world.wild(k.x, k.y) && world.dry(k.x, k.y)))
  assert.ok(tins.every((k) => [0, 1, 2, 3, 4, 5, 6, 7].some((a) => !world.dry(k.x + Math.cos(a * Math.PI / 4) * 40, k.y + Math.sin(a * Math.PI / 4) * 40) || !world.dry(k.x + Math.cos(a * Math.PI / 4) * 20, k.y + Math.sin(a * Math.PI / 4) * 20))))
})

test('le griset fonce sur qui passe, mord, et laisse de la résine : de quoi faire une torche', () => {
  const world = bare()
  const p = world.join('Dio')
  const { x, y } = world.spawn
  const g = world.spawnBeast('greyling', x + 60, y, 20)
  run(world, 3)
  assert.equal(g.state, 'rage')
  assert.ok(p.hp < 40)
  // Deux coups de lance le tuent : la résine tombe.
  Object.assign(p.inv, { spear: 1 })
  world.hold(p.id, 'spear')
  for (let k = 0; k < 4 && world.beasts.has(g.id); k++) {
    Object.assign(p, { x: g.x - 20, y: g.y, d: 3, ready: 0 })
    world.hit(p.id)
  }
  assert.ok(!world.beasts.has(g.id))
  const resin = [...world.items.values()].find((i) => i.kind === 'resin')
  assert.ok(resin)
  Object.assign(p, { x: resin.x, y: resin.y, alive: true, hp: 40 })
  assert.ok(world.pick(p.id, resin.id))
  p.inv.wood = 1
  assert.equal(world.craft(p.id, 'torch'), null)
  world.hold(p.id, 'torch')
  assert.equal(p.held, 'torch')
})

test('on sème une bête en rage : trop loin de chez elle, elle lâche et rentre', () => {
  const world = bare()
  const p = world.join('Dio')
  const { x, y } = world.spawn
  const g = world.spawnBeast('greyling', x + 60, y, 20)
  run(world, 0.5)
  assert.equal(g.state, 'rage')
  // Le joueur file (il reste toujours un peu devant).
  for (let k = 0; k < 400 && g.state === 'rage'; k++) {
    Object.assign(p, { x: g.x + 40, y: g.y, hp: 40 })
    world.step(0.05)
  }
  assert.notEqual(g.state, 'rage')
  // Il ne revient pas tout de suite, même tout près.
  Object.assign(p, { x: g.x + 30, y: g.y })
  run(world, 1)
  assert.notEqual(g.state, 'rage')
})

test('le troll : sa massue tombe un instant après, fait mal, et abat les arbres autour', () => {
  const world = bare()
  const p = world.join('Dio')
  Object.assign(p, { hp: 200 })
  p.food = [{ kind: 'cooked', until: 999 }, { kind: 'carrotsoup', until: 999 }, { kind: 'jam', until: 999 }]
  const { x, y } = world.spawn
  const troll = world.spawnBeast('troll', x + 20, y, 260)
  const tree = { id: world.nextId++, kind: 'birch', x: x + 4, y: y - 14, hp: 5, stump: false, regrow: 0 }
  world.trees.set(tree.id, tree)
  world.grid.trees.add(tree)
  world.step(0.05)
  assert.ok(troll.swing)
  const before = p.hp
  world.step(0.2)
  assert.equal(p.hp, before)
  run(world, 0.5)
  assert.ok(p.hp < before - 15, `${before} → ${p.hp}`)
  assert.ok(tree.stump)
  assert.ok(world.drain().some((n) => n.k === 'smash'))
})

test('la peau de troll : laissée par le troll, elle fait une tunique, un pantalon, une cape à l’établi de niveau 2', () => {
  const world = bare()
  const p = world.join('Dio')
  world.kill(world.spawnBeast('troll', p.x + 300, p.y, 1))
  assert.ok([...world.items.values()].some((i) => i.kind === 'trollhide' && i.n >= 1))
  bench(world, p)
  Object.assign(p.inv, { trollhide: 25, bonefragments: 13 })
  assert.equal(world.craft(p.id, 'trolltunic'), 'level')
  Object.assign(p.inv, { wood: 20, flint: 10 })
  const b = [...world.pieces.values()].find((q) => q.kind === 'workbench')
  world.addPiece('choppingblock', b.tx + 3, b.ty)
  for (const k of ['trolltunic', 'trollpants', 'trollcape', 'trollhelmet']) {
    assert.equal(world.craft(p.id, k), null)
    world.wear(p.id, k)
  }
  assert.deepEqual(p.worn, { chest: 'trolltunic', legs: 'trollpants', back: 'trollcape', head: 'trollhelmet' })
  assert.equal(world.armor(p), 19)
  assert.equal(p.inv.bonefragments, undefined)
  assert.equal(p.inv.trollhide, undefined)
})

test('le bronze à la forge : l’armure (casque, plastron, jambières), l’épée, la pioche, des clous par dix', () => {
  const world = bare()
  const p = world.join('Dio')
  bench(world, p)
  const b = [...world.pieces.values()].find((q) => q.kind === 'workbench')
  // La forge en face de l'établi : le joueur entre les deux, collé à chacun.
  world.addPiece('forge', b.tx, b.ty + 2)
  world.addPiece('choppingblock', b.tx + 3, b.ty)
  front(p, b)
  Object.assign(p.inv, { bronze: 80, wood: 20, leather: 20, hide: 20, bonefragments: 7 })
  for (const k of ['bronzehelmet', 'bronzeplate', 'bronzegreaves', 'bronzesword', 'bronzemace', 'bronzebuckler', 'bronzepickaxe', 'cultivator', 'bronzenails', 'ragtunic', 'leatherhelmet', 'deercape']) assert.equal(world.craft(p.id, k), null, k)
  assert.equal(p.inv.bronzenails, 10)
  for (const k of ['bronzehelmet', 'bronzeplate', 'bronzegreaves', 'deercape', 'bronzebuckler']) world.wear(p.id, k)
  assert.deepEqual(p.worn, { head: 'bronzehelmet', chest: 'bronzeplate', legs: 'bronzegreaves', back: 'deercape', shield: 'bronzebuckler' })
  assert.equal(world.armor(p), 25)
  world.hold(p.id, 'bronzesword')
  assert.equal(world.tool(p).dmg, 28)
  world.hold(p.id, 'bronzemace')
  assert.ok(world.tool(p).blunt)
  world.hold(p.id, 'bronzepickaxe')
  assert.equal(world.tool(p).mine, 2)
})

test('les nains gris laissent leurs yeux ; deux portails du même nom se répondent', () => {
  const world = bare()
  const p = world.join('Dio')
  const loot = world.spawnBeast('greydwarf', p.x + 300, p.y, 1)
  for (let k = 0; k < 20; k++) world.kill(world.spawnBeast('greydwarf', p.x + 300, p.y, 1))
  world.kill(loot)
  assert.ok([...world.items.values()].some((i) => i.kind === 'greydwarfeye'))
  bench(world, p)
  const placed = []
  for (const [dx, dy] of [[-55, 50], [55, 50], [-55, -45], [55, -45], [0, 65], [0, -60], [-75, 0], [75, 0]]) {
    Object.assign(p.inv, { finewood: 20, greydwarfeye: 10, surtlingcore: 2 })
    p.inv.hammer = 1
    p.held = 'hammer'
    if (world.place(p.id, 'portal', p.x + dx, p.y + dy) === null) placed.push([...world.pieces.values()].at(-1))
    if (placed.length === 2) break
  }
  assert.equal(placed.length, 2)
  const [a, b] = placed
  const at = (piece) => Object.assign(p, { x: piece.x, y: piece.y + 10 })
  at(a)
  assert.equal(world.use(p.id, a.id), 'unnamed')
  assert.equal(world.name(p.id, a.id, '  Maison  '), null)
  assert.equal(a.name, 'Maison')
  assert.equal(world.use(p.id, a.id), 'alone')
  at(b)
  world.name(p.id, b.id, 'Maison')
  at(a)
  world.drain()
  assert.equal(world.use(p.id, a.id), null)
  assert.ok(Math.hypot(p.x - b.x, p.y - b.y) < 30)
  assert.ok(world.drain().some((n) => n.t === 'moved'))
  // Le nom se garde.
  const again = bare()
  again.restore(world.snapshot())
  assert.deepEqual([...again.pieces.values()].filter((x) => x.kind === 'portal').map((x) => x.name), ['Maison', 'Maison'])
})

test('un coffre : on y range, on en reprend (la qualité suit), il se garde, et rend tout quand on le démonte', () => {
  const world = bare()
  const p = world.join('Dio')
  bench(world, p)
  let chest = null
  for (const [dx, dy] of [[-40, 40], [40, 40], [-40, -30], [40, -30], [0, 50], [0, -45]]) {
    p.inv.wood = 10
    p.inv.hammer = 1
    p.held = 'hammer'
    if (world.place(p.id, 'chest', p.x + dx, p.y + dy) === null) {
      chest = [...world.pieces.values()].at(-1)
      break
    }
  }
  assert.ok(chest)
  Object.assign(p, { x: chest.x, y: chest.y + 10 })
  Object.assign(p.inv, { stone: 30, knife: 1 })
  p.quality.knife = 3
  p.held = 'knife'
  assert.equal(world.store(p.id, chest.id, 'stone', 12), null)
  assert.equal(world.store(p.id, chest.id, 'knife'), null)
  assert.deepEqual(chest.store, { stone: 12, knife: 1 })
  assert.equal(p.inv.stone, 18)
  assert.equal(p.inv.knife, undefined)
  assert.equal(p.held, null)
  assert.equal(world.store(p.id, chest.id, 'flint'), 'none')
  for (let k = 0; k < CHEST_KINDS - 2; k++) chest.store[`k${k}`] = 1
  p.inv.flint = 3
  assert.equal(world.store(p.id, chest.id, 'flint'), 'full')
  for (let k = 0; k < CHEST_KINDS - 2; k++) delete chest.store[`k${k}`]
  assert.equal(world.unstore(p.id, chest.id, 'knife'), null)
  assert.equal(p.inv.knife, 1)
  assert.equal(p.quality.knife, 3)
  assert.equal(world.unstore(p.id, chest.id, 'stone', 2), null)
  assert.equal(chest.store.stone, 10)
  // Trop loin : rien.
  Object.assign(p, { x: chest.x + 200 })
  assert.equal(world.unstore(p.id, chest.id, 'stone'), 'far')
  Object.assign(p, { x: chest.x })
  // Il se garde.
  const again = bare()
  again.restore(world.snapshot())
  assert.deepEqual([...again.pieces.values()].find((x) => x.kind === 'chest').store, { stone: 10 })
  // Démonté (le marteau en main) : tout revient.
  p.held = 'hammer'
  assert.ok(world.unbuild(p.id, chest.id))
  assert.equal(p.inv.stone, 30)
})

test('tourner ce qu’on pose : le lit en long, la porte de profil, l’établi retourné ; ça se garde', () => {
  const world = bare()
  const p = world.join('Dio')
  bench(world, p)
  Object.assign(p.inv, { wood: 100, hide: 4 })
  const at = (dx, dy) => [Math.floor((p.x + dx) / TILE) * TILE + 8, Math.floor((p.y + dy) / TILE) * TILE + 8]
  const placed = (kind, rot, spots) => {
    p.inv.hammer = 1
    p.held = 'hammer'
    for (const [dx, dy] of spots) if (world.place(p.id, kind, ...at(dx, dy), rot) === null) return [...world.pieces.values()].at(-1)
    return null
  }
  const spots = [[-50, 40], [50, 40], [-50, -30], [50, -30], [0, 55], [-70, 0], [70, 0]]
  const bed = placed('bed', 1, spots)
  assert.ok(bed)
  assert.deepEqual([bed.w, bed.h, bed.rot], [1, 2, 1])
  // Deux cases l’une au-dessus de l’autre, la souris sur celle du bas.
  assert.ok(world.solid.get(bed.ty * SIDE + bed.tx) === bed && world.solid.get((bed.ty + 1) * SIDE + bed.tx) === bed)
  assert.equal(bed.y, (bed.ty + 2) * TILE)
  const door = placed('door', 1, spots)
  assert.equal(door.rot, 1)
  // Un quart de tour que la pièce ne prend pas : posée droite.
  const wall = placed('wall', 1, spots)
  assert.equal(wall.rot, 0)
  const again = bare()
  again.restore(JSON.parse(JSON.stringify(world.snapshot())))
  const kept = [...again.pieces.values()]
  assert.deepEqual(kept.filter((q) => q.kind === 'bed').map((q) => [q.w, q.h, q.rot]), [[1, 2, 1]])
  assert.equal(kept.find((q) => q.kind === 'door').rot, 1)
  // Démonté, le lit libère ses deux cases.
  Object.assign(p, { x: bed.x, y: bed.y + 10 })
  assert.ok(world.unbuild(p.id, bed.id))
  assert.ok(!world.solid.has(bed.ty * SIDE + bed.tx) && !world.solid.has((bed.ty + 1) * SIDE + bed.tx))
  // Une porte d’avant, dans un mur qui va du haut vers le bas : de profil.
  const old = bare()
  old.restore({ ...world.snapshot(), pieces: [{ k: 'wall', tx: 10, ty: 9 }, { k: 'door', tx: 10, ty: 10 }, { k: 'wall', tx: 10, ty: 11 }, { k: 'door', tx: 20, ty: 10 }] })
  assert.deepEqual([...old.pieces.values()].filter((q) => q.kind === 'door').map((q) => q.rot), [1, 0])
})

test('le bateau : du bois fin et des clous, posé sur l’eau près d’un établi ; on y monte, on navigue, on débarque', () => {
  const world = bare()
  const p = world.join('Dio')
  // Une rive : le premier point d'eau (avec de la place pour la coque) à côté d'une terre où marcher.
  let shore = null
  for (let y = 40; y < SIDE * TILE - 40 && !shore; y += 8) {
    for (let x = 40; x < SIDE * TILE - 40 && !shore; x += 8) {
      if (world.sailable(x, y) && world.sailable(x, y + 30) && world.walkable(x, y - 26) && world.nearBench(x, y) === false) shore = { x, y }
    }
  }
  assert.ok(shore)
  Object.assign(p, { x: shore.x, y: shore.y - 26 })
  Object.assign(p.inv, { ...BOAT.need, wood: 10 })
  p.inv.hammer = 1
  p.held = 'hammer'
  assert.equal(world.place(p.id, 'boat', shore.x, shore.y), 'bench')
  world.addPiece('workbench', Math.floor(p.x / TILE) - 1, Math.floor(p.y / TILE) - 3)
  assert.equal(world.place(p.id, 'boat', shore.x, shore.y - 30), 'blocked')
  assert.equal(world.place(p.id, 'boat', shore.x, shore.y), null)
  const boat = [...world.boats.values()][0]
  assert.equal(p.inv.bronzenails, undefined)
  // À bord : sur l'eau seulement.
  assert.equal(world.board(p.id, boat.id), null)
  assert.equal(p.boat, boat.id)
  assert.ok(!world.move(p.id, shore.x, shore.y - 26, 0, 1))
  p.moved -= 1
  assert.ok(world.move(p.id, shore.x, shore.y + 30, 0, 1))
  // Le dernier : le monde gardé, le bateau là où on l'a laissé.
  Object.assign(p, { y: shore.y + 4 })
  assert.equal(world.land(p.id), null)
  assert.equal(p.boat, null)
  assert.ok(world.walkable(p.x, p.y))
  assert.equal(boat.rider, null)
  assert.equal(boat.y, shore.y + 4)
  const again = bare()
  again.restore(JSON.parse(JSON.stringify(world.snapshot())))
  assert.deepEqual([...again.boats.values()].map((b) => [b.x, b.y]), [[boat.x, boat.y]])
  // Démonté : tout revient.
  assert.ok(world.unbuild(p.id, boat.id))
  assert.equal(p.inv.bronzenails, BOAT.need.bronzenails)
})

test('la base : un établi d’abord, des murs qui arrêtent, une porte qui s’ouvre, un lit où l’on revient ; tout se garde', () => {
  const world = bare()
  const p = world.join('Dio')
  const { x, y } = world.spawn
  p.inv.wood = 100
  p.inv.hide = 2
  // Sans établi, pas de mur.
  p.inv.hammer = 1
  p.held = 'hammer'
  assert.equal(world.place(p.id, 'wall', x + 40, y), 'bench')
  assert.equal(world.place(p.id, 'workbench', x - 40, y - 30), null)
  assert.equal(p.inv.wood, 90)
  // Une rangée de murs avec une porte au milieu, à droite du joueur.
  const wx = Math.floor((x + 40) / 16) * 16 + 8
  for (const dy of [-32, -16, 16, 32]) assert.equal(world.place(p.id, 'wall', wx, y + dy), null)
  assert.equal(world.place(p.id, 'door', wx, y), null)
  assert.equal(world.place(p.id, 'wall', wx, y), 'blocked')
  assert.ok(!world.walkable(wx, y + 32 - 4))
  const door = [...world.pieces.values()].find((q) => q.kind === 'door')
  assert.ok(!world.walkable(door.x, door.y - 4))
  // Trop loin de la porte : on ne l'ouvre pas ; tout contre, si.
  assert.equal(world.use(p.id, door.id), 'far')
  Object.assign(p, { x: door.x - 14, y: door.y - 8 })
  assert.equal(world.use(p.id, door.id), null)
  assert.ok(world.walkable(door.x, door.y - 4))
  // Un plancher sous ses pieds : on marche dessus.
  assert.equal(world.place(p.id, 'floor', x, y + 20), null)
  assert.ok(world.walkable(x, y + 20 - 4))
  // Le lit : là où l'on revient.
  assert.equal(world.place(p.id, 'bed', x - 40, y + 40), null)
  const bed = [...world.pieces.values()].find((q) => q.kind === 'bed')
  Object.assign(p, { x: bed.x, y: bed.y + 10 })
  assert.equal(world.use(p.id, bed.id), null)
  world.damage(p, 999)
  world.respawn(p.id)
  assert.deepEqual([p.x, p.y], [bed.x, bed.y + 8])
  // Ses affaires sont restées dans sa tombe, là où il est tombé.
  const tomb = [...world.tombs.values()][0]
  Object.assign(p, { x: tomb.x, y: tomb.y + 10 })
  assert.equal(world.loot(p.id, tomb.id), null)
  // Démonté : tout revient ; le reste se garde d'un redémarrage à l'autre.
  const before = p.inv.wood
  Object.assign(p, { x: wx - 20, y })
  const wall = world.solidAt(wx, y - 32)
  assert.ok(world.unbuild(p.id, wall.id))
  assert.equal(p.inv.wood, before + 2)
  assert.ok(world.walkable(wx, y - 32 - 4))
  const again = new World({ seed: 1, random: seeded(2) })
  again.restore(JSON.parse(JSON.stringify(world.snapshot())))
  assert.deepEqual([...again.pieces.values()].map((q) => q.kind).sort(), [...world.pieces.values()].map((q) => q.kind).sort())
  assert.ok(again.pieces.size >= 7)
  const saved = JSON.parse(JSON.stringify(world.save(p)))
  assert.deepEqual(again.join('Dio', { saved }).bed, p.bed)
})

test('les carottes : sauvages dans la forêt, plantées elles poussent, mûres on en récolte trois', () => {
  const world = bare()
  const p = world.join('Dio')
  const { x, y } = world.spawn
  const wild = world.drop('wildcarrot', 1, x + 10, y)
  assert.ok(world.pick(p.id, wild.id))
  assert.equal(p.inv.carrot, 1)
  // Pas sur le chemin ni dans l'eau : sur l'herbe, à côté.
  const spot = { x: x + 24, y: y + 30 }
  while (!['0', '1', '2', '7'].includes(world.tile(spot.x, spot.y - 2))) spot.y += 16
  Object.assign(p, { x: spot.x - 20, y: spot.y })
  // Sans le cultivateur en main, on ne plante pas.
  p.inv.hammer = 1
  p.held = 'hammer'
  assert.equal(world.place(p.id, 'carrot', spot.x, spot.y - 2), 'tool')
  p.inv.cultivator = 1
  world.hold(p.id, 'cultivator')
  assert.equal(p.held, 'cultivator')
  // D'abord retourner la terre (l'herbe), ensuite y planter.
  assert.equal(world.place(p.id, 'carrot', spot.x, spot.y - 2), 'untilled')
  assert.equal(world.place(p.id, 'till', spot.x, spot.y - 2), null)
  assert.equal(world.place(p.id, 'till', spot.x, spot.y - 2), 'blocked')
  assert.ok(world.changes().tilled.length === 1)
  assert.equal(world.place(p.id, 'carrot', spot.x, spot.y - 2), null)
  assert.equal(p.inv.cultivator, 1)
  assert.equal(p.inv.carrot, undefined)
  // La terre retournée se garde.
  const kept = bare()
  kept.restore(JSON.parse(JSON.stringify(world.snapshot())))
  assert.equal(kept.tilled.size, 1)
  const crop = [...world.crops.values()][0]
  assert.equal(crop.stage, 0)
  assert.ok(!world.harvest(p.id, crop.id))
  for (let k = 0; k < GROW / 2 + 1; k++) world.step(1)
  assert.equal(crop.stage, 1)
  for (let k = 0; k < GROW / 2; k++) world.step(1)
  assert.equal(crop.stage, 2)
  Object.assign(p, { x: crop.x, y: crop.y + 4 })
  assert.ok(world.harvest(p.id, crop.id))
  assert.equal(p.inv.carrot, 3)
  // On les mange crues, ou en soupe au chaudron posé sur un feu allumé.
  Object.assign(p.inv, { mushroom: 1, carrot: 4 })
  assert.equal(world.craft(p.id, 'carrotsoup'), 'cauldron')
  Object.assign(p.inv, { stone: 5, wood: 2 })
  p.held = 'hammer'
  assert.ok([[30, 0], [-30, 0], [0, 30], [0, -30], [30, 30], [-30, -30]].some(([dx, dy]) => world.build(p.id, p.x + dx, p.y + dy)))
  const fire = [...world.fires.values()][0]
  const pot = world.addPiece('cauldron', Math.floor(fire.x / TILE), Math.floor((fire.y - 8) / TILE) - 1)
  assert.ok(world.heated(pot))
  front(p, pot)
  assert.equal(world.craft(p.id, 'carrotsoup'), null)
  assert.equal(world.eat(p.id, 'carrotsoup'), null)
  assert.equal(world.eat(p.id, 'carrot'), null)
  assert.equal(world.maxHp(p), BASE_HP + 15 + 10)
  assert.equal(world.maxStamina(p), 50 + 45 + 32)
})

test('le bronze : cuivre et étain fondus, alliés à la forge ; seule la hache en bronze abat le bouleau', () => {
  const world = bare()
  const p = world.join('Dio')
  // Le bouleau résiste à la hache en silex.
  const birch = [...world.trees.values()].find((t) => t.kind === 'birch')
  Object.assign(p, { x: birch.x - 16, y: birch.y + 2, d: 3 })
  Object.assign(p.inv, { flintaxe: 1 })
  world.hold(p.id, 'flintaxe')
  world.hit(p.id)
  assert.ok(world.drain().some((n) => n.k === 'nochop' && n.kind === 'bronzeaxe'))
  assert.equal(birch.hp, 5)
  // Le cuivre se casse à la pioche.
  const copper = [...world.rocks.values()].find((k) => k.kind === 'copper')
  Object.assign(p, { x: copper.x - 24, y: copper.y + 1, d: 3, hp: 40 })
  Object.assign(p.inv, { pickaxe: 1 })
  world.hold(p.id, 'pickaxe')
  for (let k = 0; k < 12; k++) {
    p.ready = 0
    world.hit(p.id)
  }
  assert.ok(copper.gone)
  assert.equal([...world.items.values()].filter((i) => i.kind === 'copperore').length, 4)
  // La fonderie et la forge, près d'un établi, au départ.
  const { x, y } = world.spawn
  Object.assign(p, { x, y })
  Object.assign(p.inv, { wood: 100, stone: 40, surtlingcore: 5, copperore: 4, tinore: 2 })
  p.inv.hammer = 1
  p.held = 'hammer'
  assert.equal(world.place(p.id, 'workbench', x - 40, y - 30), null)
  assert.equal(world.place(p.id, 'smelter', x + 40, y - 30), null)
  const smelter = [...world.pieces.values()].find((q) => q.kind === 'smelter')
  front(p, smelter)
  for (let k = 0; k < 6; k++) assert.equal(world.use(p.id, smelter.id), null)
  assert.equal(world.use(p.id, smelter.id), 'ore')
  run(world, 6 * 12 + 1)
  const ingots = [...world.items.values()].filter((i) => i.kind === 'copper' || i.kind === 'tin')
  assert.deepEqual([ingots.filter((i) => i.kind === 'copper').length, ingots.filter((i) => i.kind === 'tin').length], [4, 2])
  for (const i of ingots) world.give(p, i.kind, 1)
  Object.assign(p.inv, { copper: 16 + 6, tin: 8, leather: 2 })
  assert.equal(world.craft(p.id, 'bronze'), 'forge')
  assert.equal(world.place(p.id, 'forge', x, y + 40), null)
  front(p, [...world.pieces.values()].find((q) => q.kind === 'forge'))
  for (let k = 0; k < 8; k++) assert.equal(world.craft(p.id, 'bronze'), null)
  assert.equal(world.craft(p.id, 'bronzeaxe'), null)
  // Elle abat le bouleau : du bois fin.
  Object.assign(p, { x: birch.x - 16, y: birch.y + 2, d: 3 })
  world.hold(p.id, 'bronzeaxe')
  for (let k = 0; k < 2; k++) {
    p.ready = 0
    world.hit(p.id)
  }
  assert.ok(birch.stump)
  assert.ok([...world.items.values()].some((i) => i.kind === 'finewood'))
})

test('l’établi : sans lui, rien de plus que la hache en pierre, la massue, la torche ; le billot et la table de tannage le montent, pour améliorer son équipement', () => {
  const world = bare()
  const p = world.join('Dio')
  Object.assign(p.inv, { wood: 100, flint: 50, leather: 30, hide: 20, stone: 10, resin: 2 })
  assert.equal(world.craft(p.id, 'club'), null)
  assert.equal(world.craft(p.id, 'torch'), null)
  assert.equal(world.craft(p.id, 'flintaxe'), 'workbench')
  assert.equal(world.craft(p.id, 'ragtunic'), 'workbench')
  const wb = bench(world, p)
  assert.equal(world.station(p, 'workbench'), 1)
  assert.equal(world.craft(p.id, 'ragtunic'), null)
  assert.equal(world.craft(p.id, 'flintaxe'), null)
  // Le cuir de cerf veut un établi plus haut.
  p.inv.bonefragments = 2
  assert.equal(world.craft(p.id, 'tunic'), 'level')
  // Améliorer : il faut un établi de niveau 2, puis 3.
  world.wear(p.id, 'ragtunic')
  assert.equal(world.armor(p), 1)
  assert.equal(world.upgrade(p.id, 'ragtunic'), 'level')
  p.inv.hammer = 1
  p.held = 'hammer'
  const free = (kind) => [[-24, 16], [24, 16], [-24, -16], [24, -16], [0, 24], [40, 0], [-40, 0]].some(([dx, dy]) => world.place(p.id, kind, wb.x + dx, wb.y + dy) === null)
  assert.ok(free('choppingblock'))
  assert.equal(world.station(p, 'workbench'), 2)
  assert.equal(world.upgrade(p.id, 'ragtunic'), null)
  assert.equal(world.armor(p), 3)
  assert.equal(world.upgrade(p.id, 'ragtunic'), 'level')
  assert.ok(free('tanningrack'))
  assert.equal(world.station(p, 'workbench'), 3)
  assert.equal(world.upgrade(p.id, 'ragtunic'), null)
  assert.equal(world.upgrade(p.id, 'ragtunic'), 'max')
  assert.equal(world.armor(p), 5)
  // La hache en silex améliorée coupe plus fort ; la qualité se garde.
  world.hold(p.id, 'flintaxe')
  const before = world.tool(p).chop
  assert.equal(world.upgrade(p.id, 'flintaxe'), null)
  assert.ok(world.tool(p).chop > before)
  assert.equal(world.upgrade(p.id, 'torch'), 'none')
  const again = world.join('Dio', { saved: JSON.parse(JSON.stringify(world.save(p))) })
  assert.deepEqual(again.quality, { ragtunic: 3, flintaxe: 2 })
  // Loin de l'établi : plus rien.
  Object.assign(p, { x: p.x + 300 })
  assert.equal(world.craft(p.id, 'knife'), 'workbench')
})

test('le bouclier : levé face au coup il en arrête une part ; levé juste avant, il pare et étourdit la bête', () => {
  const world = bare()
  const p = world.join('Dio')
  Object.assign(p.inv, { woodshield: 1, bow: 1 })
  // Sans bouclier porté, on ne garde pas.
  world.block(p.id, true)
  assert.equal(p.guard, null)
  world.wear(p.id, 'woodshield')
  const dwarf = world.spawnBeast('greydwarf', p.x + 18, p.y, 40)
  Object.assign(p, { d: 3 })
  world.enrage(dwarf, p)
  // Levé trop tôt : le coup est arrêté (en partie), pas paré.
  world.block(p.id, true)
  run(world, 0.2)
  assert.ok(dwarf.swing)
  run(world, 0.4)
  const blocked = world.drain().find((n) => n.k === 'block')
  assert.ok(blocked && blocked.dmg > 0, 'arrêté, et ça coûte de l’endurance')
  assert.equal(p.hp, BASE_HP - Math.round(12 - SHIELDS.woodshield.block))
  // Levé au dernier moment : paré, la bête chancelle et prend double.
  world.block(p.id, false)
  for (let k = 0; k < 200 && !dwarf.swing; k++) world.step(0.05)
  assert.ok(dwarf.swing)
  while (dwarf.swing.at - world.time > PARRY * 0.6) world.step(0.02)
  world.block(p.id, true)
  const hp = p.hp
  run(world, 0.3)
  assert.equal(p.hp, hp)
  assert.ok(world.drain().some((n) => n.k === 'parry'))
  assert.ok(world.time < dwarf.stun)
  world.block(p.id, false)
  world.hit(p.id)
  assert.equal(dwarf.hp, 40 - 6 * 2)
  run(world, STUN_TIME)
  assert.ok(world.time >= dwarf.stun)
  // Dos tourné : rien n'est arrêté. L'arc en main : pas de bouclier.
  world.block(p.id, true)
  p.d = 2
  p.guard = world.time - 1
  world.damage(p, 10, 'greydwarf', dwarf)
  assert.ok(world.drain().some((n) => n.k === 'hurt'))
  world.hold(p.id, 'bow')
  assert.equal(p.guard, null)
  // Le grand bouclier arrête plus, mais ne pare jamais.
  p.inv.towershield = 1
  world.wear(p.id, 'towershield')
  world.hold(p.id, null)
  Object.assign(p, { d: 3, hp: 20 })
  world.block(p.id, true)
  world.damage(p, 15, 'greydwarf', dwarf)
  assert.equal(p.hp, 20)
  assert.ok(world.drain().some((n) => n.k === 'block'))
})

test('les squelettes craignent la massue, pas les flèches ; les nains gris chassent en bande', () => {
  const world = bare()
  const p = world.join('Dio')
  const bones = world.spawnBeast('skeleton', p.x + 18, p.y, 40)
  bones.shield = false
  p.d = 3
  p.inv.club = 1
  world.hold(p.id, 'club')
  world.hit(p.id)
  assert.equal(bones.hp, 40 - 13 * 2)
  p.ready = 0
  world.hold(p.id, 'spear')
  p.inv.spear = 1
  world.hold(p.id, 'spear')
  world.hit(p.id)
  assert.equal(bones.hp, 40 - 26 - 10)
  world.kill(bones)
  assert.ok([...world.items.values()].some((i) => i.kind === 'bonefragments'))
  const a = world.spawnBeast('greydwarf', p.x + 120, p.y, 40)
  const b = world.spawnBeast('greydwarf', p.x + 220, p.y, 40)
  const far = world.spawnBeast('greydwarf', p.x + 600, p.y, 40)
  world.enrage(a, p)
  assert.deepEqual([b.state, b.target, far.state], ['rage', p.id, 'idle'])
})

test('la mort : tout reste dans une tombe, que l’on retrouve (même après un redémarrage)', () => {
  const world = bare()
  const p = world.join('Dio')
  Object.assign(p.inv, { wood: 7, bronzeplate: 1, bronzesword: 1 })
  p.quality.bronzesword = 2
  world.wear(p.id, 'bronzeplate')
  world.hold(p.id, 'bronzesword')
  const at = { x: p.x, y: p.y }
  world.damage(p, 999, 'troll')
  assert.ok(!p.alive)
  assert.deepEqual([p.inv, p.worn, p.held], [{}, {}, null])
  const tomb = [...world.tombs.values()][0]
  assert.deepEqual([tomb.x, tomb.y, tomb.name], [Math.round(at.x), Math.round(at.y), 'Dio'])
  assert.deepEqual(world.changes().tombs.map((t) => t.id), [tomb.id])
  const again = bare()
  again.restore(JSON.parse(JSON.stringify(world.snapshot())))
  const kept = [...again.tombs.values()][0]
  assert.deepEqual(kept.inv, tomb.inv)
  world.respawn(p.id)
  // Trop loin, puis tout près : tout revient, porté comme avant.
  p.inv.wood = 1
  assert.equal(world.loot(p.id, tomb.id), Math.hypot(p.x - tomb.x, p.y - tomb.y) > 56 ? 'far' : null)
  Object.assign(p, { x: tomb.x, y: tomb.y + 10 })
  world.loot(p.id, tomb.id)
  assert.deepEqual([p.inv.wood, p.worn.chest, p.held, world.quality(p, 'bronzesword')], [8, 'bronzeplate', 'bronzesword', 2])
  assert.equal(world.tombs.size, 0)
})

test('le feu de camp se démonte ; le cuivre et l’étain ne reviennent pas', () => {
  const world = bare()
  const p = world.join('Ragnar')
  Object.assign(p, { x: world.spawn.x, y: world.spawn.y })
  Object.assign(p.inv, { stone: 5, wood: 2 })
  p.inv.hammer = 1
  p.held = 'hammer'
  assert.ok(world.build(p.id, world.spawn.x + 30, world.spawn.y))
  const fire = [...world.fires.values()][0]
  world.changes()
  assert.ok(world.unbuild(p.id, fire.id))
  assert.equal(world.fires.size, 0)
  assert.deepEqual([p.inv.stone, p.inv.wood], [5, 2])
  assert.ok(world.changes().gone.includes(fire.id))
  // Le cuivre cassé reste cassé.
  const copper = [...world.rocks.values()].find((k) => k.kind === 'copper')
  world.crush(copper)
  run(world, 60 * 60)
  assert.ok(copper.gone)
  // L'étain aussi, même après un redémarrage ; et il donne son minerai.
  const full = new World({ seed: 1, random: seeded(7) })
  const tin = [...full.rocks.values()].find((k) => k.kind === 'tin')
  full.crush(tin)
  assert.equal([...full.items.values()].filter((i) => i.kind === 'tinore').length, 3)
  run(full, 60 * 60)
  assert.ok(tin.gone)
  const again = new World({ seed: 1, random: seeded(7) })
  again.restore(JSON.parse(JSON.stringify(full.snapshot())))
  assert.ok(again.rocks.get(tin.id).gone)
  // Ni étain ni cœur de surtling par terre dans la nature (les cœurs, seulement dans les cryptes).
  assert.ok(![...again.items.values()].some((i) => i.wild && (i.kind === 'tinore' || i.kind === 'surtlingcore')))
})

test('le jour et la nuit : l’heure tourne, et se garde', () => {
  const world = bare()
  assert.equal(world.clock(), 0)
  run(world, 10)
  assert.ok(Math.abs(world.clock() - 10) < 0.01)
  for (let k = 0; k < DAY; k++) world.step(1)
  assert.ok(Math.abs(world.clock() - 10) < 0.01)
  const back = bare()
  back.restore(JSON.parse(JSON.stringify(world.snapshot())))
  assert.equal(back.clock(), 10)
})

test('les nains gris restent dans la forêt noire', () => {
  const world = bare()
  world.repopulate(true)
  const dwarfs = [...world.beasts.values()].filter((b) => b.kind === 'greydwarf')
  for (const b of world.beasts.values()) if (b.kind !== 'greydwarf') world.beasts.delete(b.id)
  run(world, 10 * 60)
  const out = dwarfs.filter((b) => world.beasts.has(b.id) && !world.wild(b.x, b.y)).length
  assert.ok(out <= 1, `${out} nains gris dans la prairie`)
})

test('le lit : de jour on y reviendra ; la nuit on s’y endort, et quand tous dorment le jour se lève', () => {
  const world = bare()
  const p = world.join('Ragnar')
  const q = world.join('Bjorn')
  Object.assign(p, { x: world.spawn.x, y: world.spawn.y })
  bench(world, p)
  Object.assign(p.inv, { wood: 8, hide: 2 })
  let bed = null
  for (const [dx, dy] of [[0, 60], [0, -60], [60, 0], [-60, 0]]) {
    p.inv.hammer = 1
    p.held = 'hammer'
    if (world.place(p.id, 'bed', p.x + dx, p.y + dy) === null) {
      bed = [...world.pieces.values()].find((x) => x.kind === 'bed')
      break
    }
  }
  assert.ok(bed)
  // Devant le lit, là où l'on peut marcher.
  const spots = [[bed.x, bed.y + 6], [bed.x, bed.ty * TILE - 6], [bed.tx * TILE - 6, bed.y - 8], [(bed.tx + bed.w) * TILE + 6, bed.y - 8]].map(([x, y]) => ({ x, y })).filter((s) => world.walkable(s.x, s.y) && world.walkable(s.x, s.y + 5))
  Object.assign(p, spots[0])
  Object.assign(q, spots[1] ?? spots[0])
  // De jour : pas de sommeil.
  assert.equal(world.use(p.id, bed.id), null)
  assert.ok(!p.asleep)
  // La nuit : l'un dort, l'autre veille, rien ne passe.
  world.dawn = world.time - (DAY - NIGHT) - 10
  assert.ok(world.night())
  assert.equal(world.use(p.id, bed.id), null)
  assert.ok(p.asleep)
  run(world, 1)
  assert.ok(world.night())
  // Bouger réveille.
  assert.ok(world.move(p.id, p.x, p.y + 5, 0, 1))
  assert.ok(!p.asleep)
  // Tous les deux : le jour se lève.
  world.use(p.id, bed.id)
  world.use(q.id, bed.id)
  world.step(0.05)
  assert.ok(!world.night())
  assert.ok(world.clock() < 1)
  assert.ok(!p.asleep && !q.asleep)
})

test('la pluie vient par moments, et s’en va', () => {
  const world = bare()
  assert.ok(!world.weather.rain)
  run(world, DRY[0] + 1)
  assert.ok(world.weather.rain)
  const until = world.weather.until
  assert.ok(until - world.time <= RAIN[1] && until - world.time >= RAIN[0] - 2)
  for (let k = 0; k < RAIN[1] + 1; k++) world.step(1)
  assert.ok(!world.weather.rain)
})

test('les cryptes : un mausolée dans la forêt noire, dont l’escalier mène à un donjon à part', () => {
  const world = bare()
  assert.ok(world.crypts.length > 10, `${world.crypts.length} cryptes`)
  for (const c of world.crypts) {
    assert.ok(world.wild(c.x, c.y))
    // Le mausolée arrête, sauf sa porte (on y avance pour descendre) ; devant, on passe.
    assert.ok(!world.walkable(c.x, c.y - 20))
    assert.ok(!world.walkable(c.x + 20, c.y - 8))
    assert.ok(world.walkable(c.x, c.y - 8))
    assert.ok(world.walkable(world.doorstep(c).x, world.doorstep(c).y))
    assert.equal(c.d, null)
  }
  const c = world.crypts[0]
  const p = world.join('Dio')
  p.hp = 1000
  // Trop loin : rien ; devant la porte : on descend, hors de l'île.
  assert.equal(world.descend(p.id, c.id), 'far')
  Object.assign(p, world.doorstep(c))
  assert.equal(world.descend(p.id, c.id), null)
  assert.equal(world.cryptAt(p.x, p.y), c)
  assert.ok(p.x >= SIZE && p.y >= SIZE)
  assert.ok(world.walkable(p.x, p.y))
  assert.deepEqual(world.drain().find((n) => n.t === 'moved'), { t: 'moved', player: p.id })
  // Trois squelettes (des archers parfois) gardent chaque mausolée, dehors, sans s'en éloigner.
  const fresh = new World({ seed: 1, random: seeded(7) })
  for (const m of fresh.crypts) {
    const guards = [...fresh.beasts.values()].filter((b) => b.guards === m.id)
    assert.equal(guards.length, CRYPT.guards)
    assert.ok(guards.every((b) => ['skeleton', 'archer'].includes(b.kind) && Math.hypot(b.x - m.x, b.y - m.y) < CRYPT.post && fresh.homeAt(b, b.x, b.y)))
  }
  assert.ok([...fresh.beasts.values()].some((b) => b.guards && b.kind === 'archer'))
  // Dans la forêt noire aussi, des archers.
  assert.ok([...fresh.beasts.values()].some((b) => b.home === 'forest' && b.kind === 'archer'))
  // Les autres donjons sont plus loin que tout ce qu'on voit (et ne sont pas faits).
  assert.ok(CRYPT.stride > 2 * dungeon.SIDE * TILE)
  assert.ok(world.crypts.slice(1).every((x) => x.d === null))

  // Toutes les dalles se rejoignent depuis l'arrivée ; le tour est fermé.
  const { side, tiles } = c.d
  const open = (i) => tiles[i] !== dungeon.WALL
  for (let k = 0; k < side; k++) for (const i of [k, (side - 1) * side + k, k * side, k * side + side - 1]) assert.ok(!open(i))
  const start = Math.floor((p.y - c.oy) / TILE) * side + Math.floor((p.x - c.ox) / TILE)
  const seen = new Set([start])
  const todo = [start]
  while (todo.length) {
    const k = todo.pop()
    for (const n of [k + 1, k - 1, k + side, k - side]) if (open(n) && !seen.has(n)) seen.add(n) && todo.push(n)
  }
  assert.equal(seen.size, [...tiles].filter((t) => t !== dungeon.WALL).length)
  // De quoi faire : l'escalier, le trésor, des coffres, des pointes, des braseros, des générateurs et des squelettes.
  const kinds = new Set(c.d.props.map((x) => x.kind))
  for (const k of ['stairs', 'vault', 'coffer', 'spikes', 'brazier']) assert.ok(kinds.has(k), k)
  const mine = [...world.beasts.values()].filter((b) => b.crypt === c.id)
  assert.ok(mine.filter((b) => b.kind === 'spawner').length >= 2)
  assert.ok(mine.filter((b) => b.kind === 'skeleton' || b.kind === 'archer').length >= 4)
  assert.ok(mine.some((b) => b.kind === 'archer'))
  // Le grand coffre est gardé par un squelette à deux étoiles.
  assert.ok(mine.some((b) => b.kind === 'skeleton' && b.stars === 2 && world.zoneAt(b.x, b.y) === world.zoneAt(c.d.props.find((x) => x.kind === 'vault').x, c.d.props.find((x) => x.kind === 'vault').y + 10)))
  assert.ok(mine.every((b) => world.cryptAt(b.x, b.y) === c && world.zoneAt(b.x, b.y) >= 0))
  // Chaque donjon a son plan.
  const other = world.crypts[1]
  world.dig(other)
  assert.notEqual(other.d.tiles, c.d.tiles)

  // On ne bâtit pas dans un donjon ; un mur arrête.
  Object.assign(p.inv, { stone: 5, wood: 2, hammer: 1 })
  p.held = 'hammer'
  assert.ok(!world.build(p.id, p.x + 20, p.y + 10))
  assert.ok(!world.walkable(c.ox + 8, c.oy + 8))

  // Le grand coffre : deux cœurs de surtling (une fois).
  const vault = c.d.props.find((x) => x.kind === 'vault')
  assert.equal(world.open(p.id, vault.id), 'far')
  Object.assign(p, { x: vault.x, y: vault.y + 14 })
  assert.equal(world.open(p.id, vault.id), null)
  assert.equal(world.open(p.id, vault.id), 'empty')
  const cores = [...world.items.values()].filter((i) => i.kind === 'surtlingcore' && world.cryptAt(i.x, i.y) === c)
  assert.equal(cores.reduce((n, i) => n + i.n, 0), 2)
  assert.ok(world.changes().props.some((x) => x.id === vault.id && x.open))

  // Les pointes : sorties, elles piquent qui est dessus ; rentrées, non.
  const spike = c.d.props.find((x) => x.kind === 'spikes')
  for (const b of mine) world.beasts.delete(b.id)
  Object.assign(p, { x: spike.x, y: spike.y - TILE * 0.3, hp: 1000, spiked: 0 })
  world.time += SPIKES.every - ((world.time + spike.phase) % SPIKES.every) + SPIKES.up + 0.1
  assert.ok(!world.spiky(spike))
  world.dungeons(world.time)
  assert.equal(p.hp, 1000)
  world.time += SPIKES.every - SPIKES.up - 0.1 + 0.05
  assert.ok(world.spiky(spike))
  world.dungeons(world.time)
  assert.ok(p.hp < 1000)

  // Le générateur : quelqu'un dans sa salle, il appelle des squelettes (pas plus de tant).
  world.undig(c)
  world.dig(c)
  const spawner = [...world.beasts.values()].find((b) => b.crypt === c.id && b.kind === 'spawner')
  for (const b of [...world.beasts.values()]) if (b.crypt === c.id && b !== spawner) world.beasts.delete(b.id)
  Object.assign(p, { x: spawner.x + 30, y: spawner.y })
  assert.equal(world.zoneAt(p.x, p.y), world.zoneAt(spawner.x, spawner.y))
  // (Les coups ne portent pas, le temps de compter.)
  const damage = world.damage
  world.damage = () => {}
  run(world, SPAWNER.every * 6)
  world.damage = damage
  const raised = [...world.beasts.values()].filter((b) => b.crypt === c.id && (b.kind === 'skeleton' || b.kind === 'archer'))
  assert.ok(raised.length > 0 && raised.length <= SPAWNER.max, `${raised.length}`)
  // Les squelettes du donjon ne voient pas à travers les murs.
  const skel = raised[0]
  Object.assign(skel, { state: 'idle', target: null, calm: 0 })
  Object.assign(p, { ...c.d.arrive })
  assert.ok(!world.sees(skel, p) || world.zoneAt(skel.x, skel.y) === world.zoneAt(p.x, p.y))

  // Remonter (en montant sur l'escalier) : devant le mausolée, dehors.
  const stairs = c.d.props.find((x) => x.kind === 'stairs')
  assert.ok(world.walkable(stairs.x, stairs.y - 8))
  Object.assign(p, { x: stairs.x, y: stairs.y - 8 })
  assert.equal(world.ascend(p.id), null)
  assert.deepEqual({ x: p.x, y: p.y }, world.doorstep(c))
  assert.equal(world.cryptAt(p.x, p.y), null)

  // Vide depuis longtemps, le donjon se défait (ses bêtes et ce qui y traîne avec) ; il se refait autrement.
  const before = c.d.tiles
  world.dungeons(world.time)
  world.time += CRYPT.reset + 1
  world.dungeons(world.time)
  assert.equal(c.d, null)
  assert.ok(![...world.beasts.values()].some((b) => b.crypt === c.id))
  assert.ok(![...world.items.values()].some((i) => i.x >= SIZE))
  assert.equal(world.descend(p.id, c.id), null)
  assert.notEqual(c.d.tiles, before)
  // Parti dedans (un redémarrage) : on revient devant le mausolée ; une tombe aussi.
  const saved = world.save(p)
  const again = new World({ seed: 1, random: seeded(7) })
  assert.deepEqual((({ x, y }) => ({ x, y }))(again.join('Dio', { saved })), again.doorstep(again.crypts[0]))
  world.die(p, 'skeleton')
  const tomb = [...world.tombs.values()][0]
  assert.equal(world.cryptAt(tomb.x, tomb.y), c)
  again.restore(JSON.parse(JSON.stringify(world.snapshot())))
  assert.deepEqual((({ x, y }) => ({ x, y }))([...again.tombs.values()][0]), again.doorstep(again.crypts[0]))
})

test('les bêtes à étoiles : plus de vie, des coups plus forts, plus de butin ; plus nombreuses dans la forêt noire et la nuit', () => {
  const world = bare()
  const p = world.join('Dio')
  p.hp = 25
  const plain = world.spawnBeast('skeleton', p.x + 15, p.y, BEASTS.skeleton.hp, null, 0)
  const two = world.spawnBeast('skeleton', p.x + 15, p.y, BEASTS.skeleton.hp, null, 2)
  assert.equal(two.max, plain.max * STARS.hp[2])
  // Le même coup, deux fois plus fort.
  for (const b of [plain, two]) {
    const before = p.hp
    world.windup(b, p)
    b.swing.at = world.time
    world.blow(b)
    b.hurt = before - p.hp
    p.hp = 25
  }
  assert.ok(two.hurt > plain.hurt, `${two.hurt} > ${plain.hurt}`)
  // Le butin, d'autant.
  world.kill(two)
  const bones = [...world.items.values()].filter((i) => i.kind === 'bonefragments')
  assert.ok(bones[0].n % 3 === 0)
  // Des étoiles plus souvent dans la forêt, la nuit, dans les donjons ; jamais Eikthyr ni les générateurs.
  const share = (home) => {
    let n = 0
    for (let k = 0; k < 2000; k++) n += world.luck('greydwarf', home) > 0
    return n / 2000
  }
  const [meadow, forest, crypt] = ['meadow', 'forest', 'crypt'].map(share)
  assert.ok(meadow < forest && forest < crypt, `${meadow} ${forest} ${crypt}`)
  world.dawn = world.time - (DAY - NIGHT / 2)
  assert.ok(world.night())
  assert.ok(share('forest') > forest * 1.5)
  assert.equal(world.luck('eikthyr', 'forest') + world.luck('spawner', 'crypt'), 0)
})

test('le squelette archer : il garde ses distances, arme son arc, tire ; la flèche fait mal, le bouclier l’arrête', () => {
  const world = bare()
  const p = world.join('Dio')
  // En terrain dégagé : rien entre eux (un tronc arrête les flèches).
  const at = world.freeSpot(0, 2000, (x, y) => [...Array(12).keys()].every((k) => world.walkable(x + k * 10, y) && !world.grid.trees.near(x + k * 10, y, 40).some((t) => !t.stump)))
  Object.assign(p, at)
  const archer = world.spawnBeast('archer', at.x + 110, at.y, BEASTS.archer.hp, null, 0)
  world.enrage(archer, p)
  run(world, 0.2)
  // À portée : il ne bouge plus, il arme.
  assert.ok(archer.swing, 'il arme son arc')
  assert.ok(Math.abs(archer.x - (at.x + 110)) < 2)
  world.drain()
  run(world, 2)
  assert.ok(p.hp < 25, `${p.hp}`)
  const wound = (news) => news.filter((n) => n.k === 'hurt' && n.id === p.id).map((n) => n.dmg)
  const plain = wound(world.drain())[0]
  assert.ok(plain > 0)
  // Le bouclier levé face à lui arrête (presque toute) la flèche.
  Object.assign(p.inv, { woodshield: 1 })
  p.worn.shield = 'woodshield'
  p.d = 3
  world.block(p.id, true)
  p.guard = world.time - 1
  archer.bit = world.time
  run(world, 4)
  const news = world.drain()
  assert.ok(news.some((n) => n.k === 'block'))
  assert.ok(wound(news).every((dmg) => dmg < plain), `${wound(news)} < ${plain}`)
  // Trop près : il recule.
  Object.assign(archer, { x: at.x + 30, swing: null })
  const from = archer.x
  run(world, 0.5)
  assert.ok(archer.x > from)
})

test('le combat : la série (le coup final), l’attaque lourde (elle repousse, fait chanceler), le coup en traître', () => {
  const world = bare()
  const p = world.join('Dio')
  const target = () => {
    world.beasts.clear()
    const b = world.spawnBeast('greydwarf', p.x + 18, p.y, 1000, null, 0)
    Object.assign(b, { state: 'rage', target: p.id, d: 2 })
    return b
  }
  p.d = 3
  // Trois coups enchaînés : le troisième fait plus.
  let b = target()
  const blows = []
  for (let k = 0; k < 3; k++) {
    const before = b.hp
    world.time = Math.max(world.time, p.ready)
    world.hit(p.id)
    blows.push(before - b.hp)
  }
  const round = (v) => Math.round(v * 10) / 10
  assert.equal(blows[0], blows[1])
  assert.equal(round(blows[2]), round(blows[0] * COMBAT.finisher))
  // Trop lent : la série repart de zéro.
  world.time = p.ready + COMBAT.chain + 0.1
  let before = b.hp
  world.hit(p.id)
  assert.equal(round(before - b.hp), blows[0])
  // L'attaque lourde : plus forte, repousse, fait chanceler (le coup armé tombe à l'eau).
  b = target()
  world.windup(b, p)
  world.time = p.ready
  const x = b.x
  world.hit(p.id, true)
  assert.equal(round(1000 - b.hp), round(blows[0] * COMBAT.heavy))
  assert.ok(b.x > x + 10, `${b.x - x}`)
  assert.ok(world.time < b.stun && !b.swing)
  // Dans le dos d'une bête qui ne s'en prend pas à vous : deux fois plus (quatre au couteau).
  b = target()
  Object.assign(b, { state: 'idle', target: null, d: 3 })
  world.time = p.ready + 5
  world.hit(p.id)
  assert.equal(round(1000 - b.hp), round(blows[0] * COMBAT.sneak))
  // De face, non.
  b = target()
  Object.assign(b, { state: 'idle', target: null, d: 2 })
  world.time = p.ready + 5
  world.hit(p.id)
  assert.equal(round(1000 - b.hp), blows[0])
})

test('la roulade : rien ne porte un instant ; la lance se lance, et retombe', () => {
  const world = bare()
  const p = world.join('Dio')
  world.roll(p.id)
  const hp = p.hp
  world.damage(p, 10, 'skeleton')
  assert.equal(p.hp, hp)
  assert.ok(world.drain().some((n) => n.k === 'dodge'))
  world.time += COMBAT.iframes + 0.01
  world.damage(p, 10, 'skeleton')
  assert.ok(p.hp < hp)
  // Pendant la roulade, floor laisse aller plus vite.
  world.time += COMBAT.roll
  world.roll(p.id)
  const at = { x: p.x, y: p.y }
  world.time += 0.1
  const far = COMBAT.rollSpeed * 0.1
  assert.ok(world.move(p.id, at.x + far, at.y, 3, 2) || !world.walkable(at.x + far, at.y))

  // La lance : lancée (l'attaque lourde), elle quitte la main, touche, et retombe par terre.
  world.time += 5
  Object.assign(p, world.spawn, { d: 3 })
  Object.assign(p.inv, { spear: 1 })
  p.quality.spear = 2
  world.hold(p.id, 'spear')
  const deer = world.spawnBeast('boar', p.x + 60, p.y, 500, null, 0)
  world.hit(p.id, true)
  assert.equal(p.inv.spear, undefined)
  assert.equal(p.held, null)
  run(world, 1)
  assert.ok(deer.hp < 500)
  const spear = [...world.items.values()].find((i) => i.kind === 'spear')
  assert.ok(spear)
  Object.assign(p, { x: spear.x, y: spear.y })
  world.pick(p.id, spear.id)
  assert.equal(p.inv.spear, 1)
  assert.equal(world.quality(p, 'spear'), 2)
})

test('les bêtes varient : le squelette au bouclier pare de face, le nain gris jette des cailloux, le troll des rochers', () => {
  const world = bare()
  const p = world.join('Dio')
  p.d = 3
  const bones = world.spawnBeast('skeleton', p.x + 18, p.y, 1000, null, 0)
  Object.assign(bones, { shield: true, d: 2, state: 'rage', target: p.id })
  world.hit(p.id)
  const blow = 1000 - bones.hp
  assert.ok(world.drain().some((n) => n.k === 'guard'))
  assert.ok(blow < 6 * 0.5, `${blow}`)
  // De dos, il ne pare pas ; l'attaque lourde le brise.
  world.time = p.ready + 1
  world.hit(p.id, true)
  assert.ok(world.time < bones.stun)
  world.beasts.clear()

  // Le nain gris : un peu loin, il ne bondit pas, il lève le bras et jette un caillou, qui touche.
  const at = world.freeSpot(0, 2000, (x, y) => [...Array(16).keys()].every((k) => world.walkable(x + k * 10, y) && !world.grid.trees.near(x + k * 10, y, 30).some((t) => !t.stump)))
  Object.assign(p, at, { hp: 25 })
  const dwarf = world.spawnBeast('greydwarf', at.x + 120, at.y, 1000, null, 0)
  world.enrage(dwarf, p)
  let thrown = false
  for (let k = 0; k < 40 && !thrown; k++) {
    world.step(0.05)
    thrown = world.arrows.some((a) => a.stone)
    assert.ok(!dwarf.rush, 'pas d’élan')
  }
  assert.ok(thrown, 'un caillou')
  // Il vole jusqu'au joueur (qui ne bouge pas) et le touche.
  dwarf.throwAt = Infinity
  dwarf.state = 'idle'
  run(world, 1.5)
  assert.ok(p.hp < 25, `${p.hp}`)
  world.beasts.clear()

  // Le troll, de plus loin, jette un rocher : l'endroit se voit, il y tombe deux secondes après.
  Object.assign(p, { hp: 25 })
  const troll = world.spawnBeast('troll', at.x + 150, at.y, 1000, null, 0)
  world.enrage(troll, p)
  run(world, 2.2)
  const rock = world.bolts.find((v) => v.rock)
  assert.ok(rock, 'un rocher')
  assert.ok(Math.hypot(rock.x - p.x, rock.y - p.y) < 30)
  // On s'écarte à temps : rien.
  Object.assign(p, { x: p.x - 60 })
  const hp = p.hp
  while (world.bolts.includes(rock)) world.step(0.05)
  assert.ok(p.hp >= hp - 1, `${p.hp}`)
  assert.ok(world.drain().some((n) => n.k === 'boulder'))
})

test('les bêtes reviennent peu à peu, loin des joueurs ; les gardes d’un mausolée, au bout d’une journée', () => {
  const world = new World({ seed: 1, random: seeded(7) })
  const p = world.join('Dio')
  const greydwarfs = () => [...world.beasts.values()].filter((b) => b.kind === 'greydwarf').length
  const all = greydwarfs()
  for (const b of [...world.beasts.values()]) if (b.kind === 'greydwarf') world.beasts.delete(b.id)
  world.repopulate()
  assert.ok(greydwarfs() > 0 && greydwarfs() <= Math.ceil(all * 0.05), `${greydwarfs()} / ${all}`)
  assert.ok([...world.beasts.values()].every((b) => b.kind !== 'greydwarf' || Math.hypot(b.x - p.x, b.y - p.y) >= 900))
  // Rien n'apparaît autour d'un établi (la base est à l'abri).
  const camp = world.spawn
  const bench = world.addPiece('workbench', Math.floor(camp.x / TILE) - 1, Math.floor(camp.y / TILE) + 4)
  Object.assign(p, { x: 0, y: 0 })
  world.beasts.clear()
  for (let k = 0; k < 40; k++) world.repopulate()
  assert.ok(world.beasts.size > 100)
  assert.ok(![...world.beasts.values()].some((b) => Math.hypot(b.x - bench.x, b.y - bench.y) < 480))
  world.remove(world.pieces, bench.id)
  world.solid.clear()
  // Un troll tué : pas d'autre avant une heure.
  const trolls = () => [...world.beasts.values()].filter((b) => b.kind === 'troll').length
  const count = trolls()
  world.kill([...world.beasts.values()].find((b) => b.kind === 'troll'))
  for (let k = 0; k < 10; k++) world.repopulate()
  assert.equal(trolls(), count - 1)
  world.time += 3601
  world.repopulate()
  assert.equal(trolls(), count)
  // Les gardes : tués, ils ne reviennent pas tout de suite (ni tant qu'on est dans le donjon).
  const c = world.crypts[0]
  for (const b of [...world.beasts.values()].filter((b) => b.guards === c.id)) world.kill(b)
  Object.assign(p, { x: 0, y: 0 })
  world.repopulate()
  assert.equal([...world.beasts.values()].filter((b) => b.guards === c.id).length, 0)
  world.time += CRYPT.guardsBack + 1
  world.dig(c)
  Object.assign(p, c.d.arrive)
  world.repopulate()
  assert.equal([...world.beasts.values()].filter((b) => b.guards === c.id).length, 0)
  Object.assign(p, { x: 0, y: 0 })
  world.repopulate()
  assert.equal([...world.beasts.values()].filter((b) => b.guards === c.id).length, CRYPT.guards)
})

test('la double porte : deux portes accolées dans le même sens s’ouvrent et se ferment ensemble', () => {
  const world = bare()
  const p = world.join('Dio')
  const { x, y } = world.spawn
  const [tx, ty] = [Math.floor(x / TILE) + 2, Math.floor(y / TILE) - 3]
  const a = world.addPiece('door', tx, ty)
  const b = world.addPiece('door', tx + 1, ty)
  const lone = world.addPiece('door', tx + 4, ty, { rot: 1 })
  Object.assign(p, { x: a.x, y: a.y + 6 })
  assert.equal(world.use(p.id, a.id), null)
  assert.ok(a.open && b.open && !lone.open)
  assert.equal(world.use(p.id, b.id), null)
  assert.ok(!a.open && !b.open)
  assert.equal(world.twin(lone), null)
})

test('le chaudron se pose en visant le feu ; dessus, pas de poste de cuisson ni de viande', () => {
  const world = bare()
  const p = world.join('Dio')
  Object.assign(p, world.spawn)
  bench(world, p)
  Object.assign(p.inv, { stone: 5, wood: 2, hammer: 1, tin: 10, meat: 2 })
  p.held = 'hammer'
  let fire = null
  for (const [dx, dy] of [[0, 40], [40, 0], [-40, 0], [0, -40]]) {
    if (world.build(p.id, p.x + dx, p.y + dy)) {
      fire = [...world.fires.values()][0]
      break
    }
  }
  assert.ok(fire)
  // Le feu est sur la grille : au milieu de sa case.
  assert.equal(fire.x % TILE, TILE / 2)
  Object.assign(p, { x: fire.x + 20, y: fire.y })
  // À même le feu, la viande ne cuit pas.
  assert.ok(!world.cook(p.id, fire.id))
  // On vise le feu : le chaudron y va (sur sa case), et chauffe.
  assert.equal(world.place(p.id, 'cauldron', fire.x + 3, fire.y - 2), null)
  const pot = [...world.pieces.values()].find((x) => x.kind === 'cauldron')
  assert.equal(pot.tx, Math.floor(fire.x / TILE))
  assert.ok(world.heated(pot))
  // Le feu ne cuit plus de viande, et le poste de cuisson n'y va plus.
  assert.equal(world.cook(p.id, fire.id), false)
  p.inv.wood = 2
  assert.equal(world.place(p.id, 'cookingstation', fire.x, fire.y), 'blocked')
})

test('le poste de cuisson : démonté, il rend la viande qui cuisait (crue)', () => {
  const world = bare()
  const p = world.join('Dio')
  Object.assign(p, world.spawn)
  bench(world, p)
  Object.assign(p.inv, { stone: 5, wood: 4, hammer: 1, meat: 2 })
  p.held = 'hammer'
  assert.ok([[0, 40], [40, 0], [-40, 0], [0, -40]].some(([dx, dy]) => world.build(p.id, p.x + dx, p.y + dy)))
  const fire = [...world.fires.values()][0]
  Object.assign(p, { x: fire.x + 20, y: fire.y })
  assert.equal(world.place(p.id, 'cookingstation', fire.x, fire.y), null)
  const spit = world.spitOn(fire)
  assert.ok(world.cook(p.id, fire.id) && world.cook(p.id, fire.id))
  assert.equal(p.inv.meat, undefined)
  assert.ok(world.unbuild(p.id, spit.id))
  assert.equal(p.inv.meat, 2)
  assert.equal(fire.cooking.length, 0)
})

test('le radeau : du bois, du cuir, de la résine, posé sur l’eau près d’un établi ; il se garde et se démonte', () => {
  const world = bare()
  const p = world.join('Dio')
  // Une rive : la terre ferme à côté de l'eau, près du départ.
  let shore = null
  for (let r = 40; r < 4000 && !shore; r += 16) {
    for (let a = 0; a < Math.PI * 2 && !shore; a += 0.2) {
      const x = world.spawn.x + Math.cos(a) * r
      const y = world.spawn.y + Math.sin(a) * r
      // De la terre derrière soi (pour l'établi), l'eau devant.
      const land = [[-40, 0], [-40, -20], [-20, -20], [0, -20]].every(([dx, dy]) => world.walkable(x + dx, y + dy))
      if (land && world.walkable(x, y) && world.sailable(x + 50, y) && world.sailable(x + 60, y)) shore = { x, y }
    }
  }
  assert.ok(shore)
  Object.assign(p, shore)
  bench(world, p)
  Object.assign(p.inv, { wood: 20, leather: 6, resin: 6 })
  delete p.inv.hammer
  p.held = null
  assert.equal(world.place(p.id, 'raft', p.x + 55, p.y), 'hammer')
  p.inv.hammer = 1
  p.held = 'hammer'
  assert.equal(world.place(p.id, 'raft', p.x + 55, p.y), null)
  const raft = [...world.boats.values()][0]
  assert.equal(raft.kind, 'raft')
  assert.equal(p.inv.leather, undefined)
  const again = bare()
  again.restore(JSON.parse(JSON.stringify(world.snapshot())))
  assert.equal([...again.boats.values()][0].kind, 'raft')
  assert.ok(world.unbuild(p.id, raft.id))
  assert.deepEqual([p.inv.wood, p.inv.leather, p.inv.resin], [20, 6, 6])
})

test('l’eau : près de la rive, on patauge (sans se noyer) ; au large, on nage (pas d’arme), à bout de souffle on se noie ; un pont s’y pose, on y marche', () => {
  const world = bare()
  const p = world.join('Dio')
  // De la rive vers le large : de la terre, deux cases d'eau peu profonde, puis l'eau profonde.
  const river = []
  for (let i = 0; i < SIDE * SIDE && !river.length; i += 7) {
    const [tx, ty] = [i % SIDE, Math.floor(i / SIDE)]
    if (world.tiles[i] !== T.deep || tx < 4 || ty < 3 || tx > SIDE - 4 || ty > SIDE - 4) continue
    if (world.tiles[i - 1] === T.water && world.tiles[i - 2] === T.water && world.walkable((tx - 2.5) * TILE, (ty + 0.5) * TILE)) river.push([tx, ty])
  }
  assert.ok(river.length)
  const [tx, ty] = river[0]
  const [wx, wy] = [(tx + 0.5) * TILE, (ty + 0.5) * TILE]
  // Au bord, on patauge : ni nage, ni noyade.
  Object.assign(p, { x: wx - 16 * 2, y: wy })
  assert.ok(world.wadeable(p.x, p.y) && !world.swimming(p))
  assert.ok(!world.drown(p.id))
  // Plus loin, on nage.
  p.moved = world.time - 1
  assert.ok(world.move(p.id, wx, wy, 3, 1))
  assert.ok(world.swimming(p))
  assert.ok(!world.walkable(wx, wy))
  // À bout d'endurance : la vie s'en va, une fois par seconde.
  const hp = p.hp
  assert.ok(world.drown(p.id))
  assert.ok(!world.drown(p.id))
  assert.equal(p.hp, hp - 5)
  // Pas de coup à la nage.
  const ready = p.ready
  world.hit(p.id)
  assert.equal(p.act ?? null, null)
  assert.equal(p.ready, ready)
  // Un pont : sur l'eau, près d'un établi ; on y marche, on n'y nage plus.
  Object.assign(p, { x: wx - 16 * 2, y: wy })
  world.addPiece('workbench', tx - 6, ty - 2)
  Object.assign(p.inv, { wood: 10, hammer: 1 })
  p.held = 'hammer'
  assert.equal(world.place(p.id, 'bridge', wx, wy), null)
  assert.ok(world.walkable(wx, wy))
  Object.assign(p, { x: wx, y: wy })
  assert.ok(!world.swimming(p))
  assert.ok(!world.drown(p.id))
  // Pas de pont sur la terre.
  assert.equal(world.place(p.id, 'bridge', wx - 16 * 3, wy), 'blocked')
})

test('une bête en chasse cherche son chemin : elle fait le tour de la maison et entre par la porte ouverte (fermée, non)', () => {
  for (const open of [true, false]) {
    const world = bare()
    const p = world.join('Dio')
    // Une maison de 7 × 7 cases autour du joueur, la porte au milieu du bas.
    const [cx, cy] = [Math.floor(world.spawn.x / TILE), Math.floor(world.spawn.y / TILE)]
    for (let i = -3; i <= 3; i++) {
      for (const [x, y] of [[cx + i, cy - 3], [cx + i, cy + 3], [cx - 3, cy + i], [cx + 3, cy + i]]) {
        if (x === cx && y === cy + 3) world.addPiece('door', x, y, { open })
        else if (!world.solid.has(y * SIDE + x)) world.addPiece('wall', x, y)
      }
    }
    Object.assign(p, { x: (cx + 0.5) * TILE, y: (cy + 0.5) * TILE, hp: 1e9 })
    // Le squelette au nord, derrière le mur du haut.
    const b = world.spawnBeast('skeleton', (cx + 0.5) * TILE, (cy - 7) * TILE, 1e6, 'meadow')
    world.enrage(b, p)
    let reached = false
    for (let k = 0; k < 20 * 30 && !reached; k++) {
      world.step(0.05)
      b.until = world.time + 10
      reached = Math.hypot(b.x - p.x, b.y - p.y) < 30
    }
    assert.equal(reached, open, open ? 'par la porte ouverte' : 'la porte fermée')
  }
})

test('le sanglier blessé charge, repart un peu, et revient à l’assaut', () => {
  const world = bare()
  const p = world.join('Dio')
  Object.assign(p, { x: world.spawn.x, y: world.spawn.y, hp: 1e9 })
  const b = world.spawnBeast('boar', p.x + 90, p.y, 1e6, 'meadow')
  world.enrage(b, p)
  const hits = []
  let rushes = 0
  let backed = 0
  let far = 0
  let was = false
  for (let k = 0; k < 20 * 15; k++) {
    const hp = p.hp
    world.step(0.05)
    b.until = world.time + 10
    if (p.hp < hp) hits.push(world.time)
    if (b.rush && !was) rushes++
    was = !!b.rush
    if (b.back > world.time) {
      backed++
      far = Math.max(far, Math.hypot(b.x - p.x, b.y - p.y))
    }
  }
  assert.ok(rushes >= 2, `${rushes} charges`)
  assert.ok(backed > 10, 'il repart après sa charge')
  assert.ok(far > 50, `il s'éloigne (${Math.round(far)})`)
  assert.ok(hits.length >= 2, `${hits.length} coups`)
})

test('les graines : une souche arrachée en laisse parfois ; plantée, une pousse devient un arbre ; les buissons et les champignons plantés repoussent', () => {
  const { PLANTS } = require('../src/ronnheim/world')
  const world = bare()
  const p = world.join('Dio')
  // Les souches : sur beaucoup, des graines de leur arbre.
  const beeches = [...world.trees.values()].filter((t) => t.kind === 'beech').slice(0, 40)
  for (const t of beeches) world.uproot(t)
  const seeds = [...world.items.values()].filter((i) => i.kind === 'beechseeds').length
  assert.ok(seeds > 5 && seeds < 30, `${seeds} graines`)
  // Dans la prairie, au cultivateur : une pousse ; dans la forêt noire, non (le hêtre n'y pousse pas).
  // (Un coin de prairie à plat : ni falaise ni rampe autour.)
  const flat = (x, y) => [-64, -48, -32, -16, 0, 16, 32, 48, 64].every((dx) => [-32, -16, 0, 16, 32].every((dy) => !world.steep(x + dx, y + dy)))
  const spot = world.freeSpot(0, 8000, (x, y) => !world.wild(x, y) && [0, -48].every((dx) => [T.grass, T.dark, T.light].includes(world.tile(x + dx, y))) && !world.grid.trees.near(x, y, 60).length && Math.hypot(x - world.spawn.x, y - world.spawn.y) > 200 && flat(x, y))
  Object.assign(p, { x: spot.x, y: spot.y + 30 })
  Object.assign(p.inv, { beechseeds: 2, firecone: 1, cultivator: 1, raspberry: 10 })
  p.held = 'cultivator'
  assert.equal(world.place(p.id, 'beechseeds', spot.x, spot.y), null)
  const sprout = [...world.crops.values()].find((c) => c.kind === 'beechseeds')
  assert.ok(sprout)
  assert.equal(world.place(p.id, 'beechseeds', spot.x + 8, spot.y), 'blocked', 'trop près de la pousse')
  assert.equal(world.place(p.id, 'firecone', spot.x - 48, spot.y), 'biome')
  // Un framboisier, à côté.
  assert.equal(world.place(p.id, 'raspberrybush', spot.x - 48, spot.y), null)
  const bush = [...world.crops.values()].find((c) => c.kind === 'raspberrybush')
  assert.ok(!world.harvest(p.id, bush.id), 'pas encore mûr')
  // Le temps passe : la pousse est un arbre (qui se garde), le framboisier se cueille, et repousse.
  const trees = world.trees.size
  world.time += PLANTS.beechseeds.grow + 1
  world.step(0.05)
  assert.equal(world.trees.size, trees + 1)
  assert.ok(!world.crops.has(sprout.id))
  const tree = [...world.trees.values()].find((t) => t.grown)
  assert.equal(tree.kind, 'beech')
  assert.ok(world.changes().grown.some((t) => t.id === tree.id))
  Object.assign(p, { x: bush.x + 10, y: bush.y })
  assert.ok(world.harvest(p.id, bush.id))
  assert.equal(p.inv.raspberry, 3)
  assert.ok(world.crops.has(bush.id) && bush.stage < 2, 'il repousse')
  assert.ok(!world.harvest(p.id, bush.id))
  world.time += PLANTS.raspberrybush.grow / 2 + 1
  world.step(0.05)
  assert.ok(world.harvest(p.id, bush.id))
  // Au redémarrage : l'arbre et le framboisier sont là.
  const again = new World({ seed: 1, random: seeded(7) })
  again.restore(JSON.parse(JSON.stringify(world.snapshot())))
  assert.ok([...again.trees.values()].some((t) => t.grown && t.x === tree.x && t.y === tree.y))
  assert.ok([...again.crops.values()].some((c) => c.kind === 'raspberrybush' && c.tx === bush.tx))
})

test('le relief : des paliers, des falaises qu’on ne traverse pas, et toujours un passage (une rampe) jusqu’au bord de l’eau', () => {
  const { RELIEF } = require('../src/ronnheim/world')
  for (const seed of [3, 23, 58]) {
    const world = new World({ seed, random: seeded(1) })
    const { relief, cliff, tiles } = world
    const n = SIDE * SIDE
    const counts = [0, 0, 0, 0]
    let ramps = 0
    for (let i = 0; i < n; i++) {
      if (tiles[i] === T.water || tiles[i] === T.deep) continue
      counts[relief[i] & ~RELIEF.ramp]++
      if (relief[i] & RELIEF.ramp) ramps++
    }
    assert.ok(counts.slice(1).every((c) => c > 1000), `${counts}`)
    assert.ok(ramps > 50, `${ramps} rampes`)
    // Une falaise ne se traverse pas ; le départ est sur la plaine.
    const c = cliff.indexOf(1)
    assert.ok(!world.walkable(((c % SIDE) + 0.5) * TILE, (Math.floor(c / SIDE) + 0.5) * TILE))
    assert.equal(relief[world.cell(world.spawn.x, world.spawn.y)], 0)
    // De chaque case où l'on marche, on rejoint le palier 0 (à pied, sans nager).
    const walk = (i) => tiles[i] !== T.water && tiles[i] !== T.deep && !cliff[i]
    const reach = new Uint8Array(n)
    const queue = []
    for (let i = 0; i < n; i++) if (walk(i) && (relief[i] & ~RELIEF.ramp) === 0) { reach[i] = 1; queue.push(i) }
    for (let k = 0; k < queue.length; k++) {
      const i = queue[k]
      const x = i % SIDE
      for (const j of [x > 0 ? i - 1 : -1, x < SIDE - 1 ? i + 1 : -1, i - SIDE, i + SIDE]) {
        if (j >= 0 && j < n && !reach[j] && walk(j)) { reach[j] = 1; queue.push(j) }
      }
    }
    let lost = 0
    for (let i = 0; i < n; i++) if (walk(i) && !reach[i]) lost++
    assert.equal(lost, 0, `graine ${seed} : ${lost} cases enfermées`)
  }
})

test('on saute une falaise en descendant, pas en montant ; pas par-dessus deux paliers d’un coup s’il y a du plat entre', () => {
  const world = bare()
  const p = world.join('Dio')
  const { relief, cliff } = world
  // Une falaise au sud d'un palier : en haut, la case au nord ; en bas, la case au sud.
  let spot = null
  for (let i = SIDE * 10; i < SIDE * (SIDE - 10) && !spot; i++) {
    if (!cliff[i] || relief[i] & 8) continue
    const [up, down] = [i - SIDE, i + SIDE]
    const x = ((i % SIDE) + 0.5) * TILE
    const y = (Math.floor(i / SIDE) + 0.5) * TILE
    if (!cliff[up] && (relief[up] & 7) === (relief[i] & 7) && !cliff[down] && (relief[down] & 7) < (relief[i] & 7) && world.walkable(x, y - TILE) && world.walkable(x, y + TILE)) spot = { x, y }
  }
  assert.ok(spot)
  Object.assign(p, { x: spot.x, y: spot.y - TILE })
  // À pied, la falaise ne se traverse pas.
  p.moved = world.time - 1
  assert.ok(!world.move(p.id, spot.x, spot.y, 0, 1))
  // En sautant, si : on atterrit en bas.
  assert.ok(world.jump(p.id, spot.x, spot.y + TILE))
  assert.deepEqual([p.x, p.y], [spot.x, spot.y + TILE])
  // Pas en remontant ; pas trop loin ; pas sur une falaise.
  assert.ok(!world.jump(p.id, spot.x, spot.y - TILE))
  Object.assign(p, { x: spot.x, y: spot.y - TILE })
  assert.ok(!world.jump(p.id, spot.x, spot.y + TILE * 5))
  assert.ok(!world.jump(p.id, spot.x, spot.y))
})

test('jeter par terre : toute la pile tombe devant soi, n’importe qui la ramasse', () => {
  const world = bare()
  const p = world.join('Dio')
  const q = world.join('Kuro')
  Object.assign(p.inv, { wood: 7, axe: 1 })
  world.hold(p.id, 'axe')
  assert.ok(!world.discard(p.id, 'stone'))
  assert.ok(world.discard(p.id, 'wood'))
  assert.equal(p.inv.wood, undefined)
  const item = [...world.items.values()].find((i) => i.kind === 'wood')
  assert.equal(item.n, 7)
  assert.ok(Math.hypot(item.x - p.x, item.y - p.y) > 20)
  // L'outil en main aussi : il n'est plus en main.
  assert.ok(world.discard(p.id, 'axe'))
  assert.equal(p.held, null)
  Object.assign(q, { x: item.x, y: item.y + 4 })
  assert.ok(world.pick(q.id, item.id))
  assert.equal(q.inv.wood, 7)
})

test('le sac plein : la tombe garde ce qui ne tient pas ; on ne ramasse pas une sorte de plus', () => {
  const world = bare()
  const p = world.join('Dio')
  const kinds = ['wood', 'stone', 'flint', 'resin', 'meat', 'leather', 'hide', 'antler', 'mushroom', 'raspberry', 'blueberries', 'carrot', 'copperore', 'tinore', 'copper', 'tin', 'bronze', 'finewood', 'corewood', 'bonefragments', 'greydwarfeye', 'trollhide', 'arrow', 'flintarrow', 'cooked', 'jam', 'carrotsoup', 'bronzenails', 'surtlingcore', 'trophy', 'hardantler', 'beechseeds', 'birchseeds', 'firecone', 'pinecone', 'torch', 'club', 'knife', 'spear', 'axe']
  assert.equal(kinds.length, 40)
  for (const k of kinds) p.inv[k] = 1
  // Une tombe : du bois (on en a déjà), une hache en bronze et des clous (non).
  const tomb = { id: world.nextId++, x: p.x + 10, y: p.y, name: 'Dio', inv: { wood: 5, bronzeaxe: 1 }, quality: {}, worn: {}, held: null }
  world.tombs.set(tomb.id, tomb)
  assert.equal(world.loot(p.id, tomb.id), 'full')
  assert.equal(p.inv.wood, 6)
  assert.ok(world.tombs.has(tomb.id))
  assert.deepEqual(tomb.inv, { bronzeaxe: 1 })
  // Une case se libère : on reprend le reste, la tombe s'en va.
  delete p.inv.knife
  assert.equal(world.loot(p.id, tomb.id), null)
  assert.equal(p.inv.bronzeaxe, 1)
  assert.ok(!world.tombs.has(tomb.id))
  // Plein encore : une sorte de plus ne se ramasse pas, une qu'on a, si.
  const nails = world.drop('stone', 2, p.x + 5, p.y)
  const shield = world.drop('woodshield', 1, p.x + 5, p.y)
  assert.ok(!world.pick(p.id, shield.id))
  assert.ok(world.pick(p.id, nails.id))
})

test('le sac : des piles (au-delà, une case de plus), un poids ; trop chargé, on ne bouge plus', () => {
  const { CARRY, stackOf } = require('../src/ronnheim/world')
  const world = bare()
  const p = world.join('Dio')
  assert.equal(stackOf('wood'), 50)
  assert.equal(stackOf('axe'), 1)
  p.inv.wood = 120
  assert.equal(world.bag(p), 3)
  // 38 cases de plus : il reste 30 bois de place dans la 3e pile, et une case.
  for (let k = 0; k < 38; k++) p.inv['x' + k] = 1
  assert.equal(world.bag(p), 41)
  for (let k = 0; k < 38; k++) delete p.inv['x' + k]
  for (let k = 0; k < 36; k++) p.inv['x' + k] = 1
  assert.equal(world.fit(p, 'wood', 100), 30 + 50)
  assert.equal(world.fit(p, 'stone', 100), 50)
  // Ramasser : ce qui tient ; le reste reste par terre.
  const pile = world.drop('wood', 100, p.x + 5, p.y)
  assert.ok(world.pick(p.id, pile.id))
  assert.equal(p.inv.wood, 200)
  assert.equal(pile.n, 20)
  assert.ok(world.items.has(pile.id))
  // Le poids : au bout, on ne bouge plus.
  for (const k of Object.keys(p.inv)) delete p.inv[k]
  p.inv.copperore = CARRY / 10
  assert.ok(world.load(p) >= CARRY)
  p.moved = world.time - 1
  assert.ok(!world.move(p.id, p.x + 10, p.y, 3, 1))
  p.inv.copperore -= 1
  assert.ok(world.move(p.id, p.x + 10, p.y, 3, 1))
})
