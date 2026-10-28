const { WebSocketServer } = require('ws')
const { World, VERSION, SIDE, TILE, RECIPES, BUILDS, FOODS, UPGRADES, QUALITY_MAX, BOSS, CARRY, STACK, WEIGHT, stackOf } = require('./world')
const { clean } = require('../chat')
const { route } = require('../upgrade')

const PATH = '/v1/ronnheim/ws'
// Le monde avance tant de fois par seconde, et les joueurs le voient à chaque fois.
const TICK_MS = 50
// Ce qu'un joueur voit autour de lui (les autres joueurs, les bêtes, les flèches).
const VIEW = 720
// Le décor (arbres, rochers, buissons, ce qui traîne par terre) s'envoie par zones de tant de pixels de
// côté : celles autour du joueur, chacune une fois (ce qui y change ensuite arrive avec le reste).
const REGION = 1024
// Au-delà, les messages d'un joueur sont ignorés (par seconde).
const MESSAGES_MAX = 60
const SAY_EVERY = 700
const BUFFER_MAX = 256 * 1024
// Ce que chacun garde, et le monde, sont écrits dans la base tous les tant (et quand on part).
const SAVE_EVERY = 30 * 1000
const PER_IP = 4
const PER_IP_MINUTE = 30

const BEAST_KIND = { deer: 0, boar: 1, eikthyr: 2, greyling: 3, greydwarf: 4, troll: 5, skeleton: 6, spawner: 7, archer: 8 }
// Ce qu'il y a dans un donjon (voir PROPS).
const PROP_KIND = { stairs: 0, coffer: 1, vault: 2, spikes: 3, brazier: 4, bones: 5 }
const BEAST_STATE = { idle: 0, walk: 1, graze: 2, flee: 3, rage: 4, charge: 5 }
// Une bête qui lève le bras (le troll sa massue, Eikthyr ses bois : 6), Eikthyr qui frappe le sol (6
// aussi) ou appelle la foudre (7), le coup qui tombe (8), le temps du geste ; étourdie (parée : 9).
const STOMP = 6
const CAST = 7
const BITE = 8
const STUNNED = 9
const ACT = { hit: 1, shoot: 2, eat: 3, roll: 4, heavy: 5 }
const HELD = { axe: 1, bow: 2, club: 3, knife: 4, spear: 5, flintaxe: 6, pickaxe: 7, torch: 8, bronzeaxe: 9, finebow: 10, bronzesword: 11, bronzepickaxe: 12, bronzemace: 13, hammer: 14, cultivator: 15 }
const TREE_KIND = { beech: 0, birch: 1, fir: 2, pine: 3 }

// La carte, serrée : chaque suite de cases pareilles s'écrit par une lettre (a pour '0', b pour '1'...)
// suivie de sa longueur (rien pour une seule case).
function pack (tiles) {
  const out = []
  for (let i = 0; i < tiles.length;) {
    let j = i + 1
    while (j < tiles.length && tiles[j] === tiles[i]) j++
    out.push(String.fromCharCode(97 + tiles.charCodeAt(i) - 48) + (j - i > 1 ? j - i : ''))
    i = j
  }
  return out.join('')
}
const ROCK_KIND = { stone: 0, copper: 1, tin: 2 }
const CROP_KIND = { carrot: 0, beechseeds: 1, birchseeds: 2, firecone: 3, pinecone: 4, raspberrybush: 5, blueberrybush: 6, mushroompatch: 7 }
const PIECE_KIND = { workbench: 0, floor: 1, wall: 2, door: 3, bed: 4, standingtorch: 5, smelter: 6, forge: 7, choppingblock: 8, tanningrack: 9, portal: 10, chest: 11, cauldron: 12, rug: 13, bridge: 14, cookingstation: 15, fence: 16, palisade: 17 }
// Ce que porte un joueur, en un nombre : le haut (3 bits : 1 haillons, 2 cuir, 3 troll, 4 bronze), le
// bas (pareil, décalé de 3), le casque (2 bits : 1 cuir, 2 bronze, 3 troll ; décalé de 6), la cape (2
// bits : 1 cerf, 2 troll ; décalé de 8), le bouclier (2 bits : 1 en bois, 2 grand, 3 en bronze ; décalé
// de 10).
const WORN = {
  ragtunic: 1, tunic: 2, trolltunic: 3, bronzeplate: 4,
  ragpants: 1 << 3, pants: 2 << 3, trollpants: 3 << 3, bronzegreaves: 4 << 3,
  leatherhelmet: 1 << 6, bronzehelmet: 2 << 6, trollhelmet: 3 << 6,
  deercape: 1 << 8, trollcape: 2 << 8,
  woodshield: 1 << 10, towershield: 2 << 10, bronzebuckler: 3 << 10
}

// Ronnheim en ligne : un WebSocket sur /v1/ronnheim/ws, ouvert sur le serveur HTTP de floor.
//
// Le premier message donne le jeton ({ t: 'hello', token }) : seulement avec un pseudo. Ensuite :
// { t: 'gather', id } (un framboisier), { t: 'wear', k } (mettre ou enlever un vêtement), { t: 'offer' } (les
// bois de cerf sur l'autel : Eikthyr arrive), { t: 'pos', x, y, d, m } (le jeu bouge le joueur lui-même et dit où il est ; d : 0 bas, 1 haut, 2 gauche,
// 3 droite ; m : 0 immobile, 1 marche, 2 course), { t: 'hit', heavy } (un coup devant soi, avec ce qu'on tient ; lourd, ou dans la série),
// { t: 'roll' } (la roulade : un instant où rien ne porte), { t: 'drown' } (à la nage, plus d'endurance), { t: 'jump', x, y } (sauter une falaise, en descendant),
// { t: 'shoot', a, p } (une flèche vers l'angle a, l'arc bandé de p : 0 à 1), { t: 'pick', id }, { t: 'craft', r } (une recette),
// { t: 'build', x, y } (un feu de camp), { t: 'place', k, x, y, r } (une construction, tournée de r, ou planter une carotte : k
// 'carrot'), { t: 'unbuild', id } (la démonter), { t: 'use', id } (une porte, un lit, la fonderie, un portail), { t: 'name', id, name } (nommer un portail),
// { t: 'board', id } et { t: 'land' } (monter dans un bateau, débarquer), { t: 'block', on } (lever ou baisser le bouclier),
// { t: 'loot', id } (reprendre ce qu'il y a dans une tombe), { t: 'store', id, k, n } et { t: 'unstore', id, k, n } (ranger dans un coffre, en reprendre ; sans n : tout),
// { t: 'descend', id } et { t: 'ascend' } (l'escalier d'un mausolée : on descend dans son donjon, on en
// remonte), { t: 'open', id } (un coffre d'un donjon), { t: 'harvest', id } (une carotte mûre), { t: 'upgrade', k } (améliorer un outil, une arme, un vêtement), { t: 'fuel', id } et { t: 'cook', id } (sur un feu), { t: 'eat', k },
// { t: 'hold', k } (l'outil en main, null : les mains nues), { t: 'order', slots } (l'inventaire rangé : ce qui va dans
// chaque case, null : vide), { t: 'respawn' }, { t: 'say', text }, { t: 'ping', n }, { t: 'pause', on } (le menu
// ouvert : seul dans le monde, il s'arrête).
//
// floor envoie { t: 'welcome' } (la carte, ce qu'il y a dessus, les recettes, ce qu'on construit), { t: 'me' } (l'inventaire,
// ce qu'on tient, à chaque changement), 20 fois par seconde ce que le joueur voit ({ t: 's' }, voir `frame`),
// { t: 'o' } (les arbres, objets, feux, constructions, carottes et ce qu'il y a dans les donjons qui ont changé, pour tous),
// { t: 'crypt' } (le donjon où l'on vient d'arriver : son plan, ce qu'il y a dedans ; id null : dehors), { t: 'fx' } (les coups, les arbres qui
// tombent, les bêtes qui meurent), { t: 'got' } (ce qu'il vient d'avoir), { t: 'pos' } (sa position refusée :
// la voici), { t: 'dead' }, { t: 'chat' }, { t: 'pong' }.
//
// Le monde dure : quand plus personne n'est là, il s'arrête et attend (souches, feux et inventaires
// sont dans la base, pour un redémarrage de floor).
function ronnheim (server, db, players, { random, trustProxy = false, seed = null, perIp = PER_IP, perIpMinute = PER_IP_MINUTE } = {}) {
  const loadWorld = db.prepare("SELECT v FROM ronnheim_world WHERE k = 'state'")
  const saveWorld = db.prepare("INSERT INTO ronnheim_world (k, v) VALUES ('state', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v")
  const loadPlayer = db.prepare('SELECT data FROM ronnheim_players WHERE player_id = ?')
  const savePlayer = db.prepare(`INSERT INTO ronnheim_players (player_id, data, at) VALUES (?, ?, ?)
    ON CONFLICT (player_id) DO UPDATE SET data = excluded.data, at = excluded.at`)

  const state = (() => {
    try {
      return JSON.parse(loadWorld.get()?.v ?? 'null')
    } catch {
      return null
    }
  })()
  // Un monde d'une autre version est oublié : un nouveau, d'une graine au hasard (les joueurs gardent
  // leurs affaires, et repartent du départ).
  const fresh = state?.v === VERSION
  const world = new World({ seed: fresh ? state.seed : seed ?? Math.floor(Math.random() * 2 ** 31), random })
  world.restore(state)
  const packed = pack(world.tiles)
  // Le relief, en chiffres (le palier, plus 8 pour une rampe : de 0 à 9 et au-delà), serré pareil.
  const relief = pack(Array.from(world.relief, (v) => String.fromCharCode(48 + v)).join(''))
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 })
  route(server, PATH, wss)
  const clients = new Set()
  const ips = new Map()
  let timer = null
  let last = 0
  let saved = Date.now()

  const send = (client, msg) => {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(msg))
  }
  const ready = () => [...clients].filter((c) => c.ready)
  const clientOf = (id) => [...clients].find((c) => c.id === id)
  const r = Math.round

  function keep (client) {
    const p = client.id && world.players.get(client.id)
    if (p && client.account) savePlayer.run(client.account.id, JSON.stringify(world.save(p)), Date.now())
  }

  function saveAll () {
    for (const c of ready()) keep(c)
    saveWorld.run(JSON.stringify(world.snapshot()))
    saved = Date.now()
  }

  const treeRow = (t) => [t.id, TREE_KIND[t.kind], t.x, t.y, t.stump ? 1 : 0]
  const rockRow = (k) => [k.id, k.x, k.y, k.gone ? 1 : 0, ROCK_KIND[k.kind]]
  const bushRow = (b) => [b.id, b.x, b.y, b.ripe ? 1 : 0, b.kind === 'blueberry' ? 1 : 0]
  // Une construction : id, sorte, case en haut à gauche, ouverte (une porte) ou allumée (la fonderie),
  // tournée (0 à 3, voir PIECES), le minerai qui attend d'être fondu (la fonderie).
  const pieceRow = (p) => [p.id, PIECE_KIND[p.kind], p.tx, p.ty, p.open || p.queue.length ? 1 : 0, p.rot, p.queue.length]
  const cropRow = (c) => [c.id, c.tx, c.ty, c.stage, CROP_KIND[c.kind]]
  // Un bateau : id, où, tourné vers (comme un joueur), quelqu'un à bord, un radeau (1) ou un drakkar.
  const boatRow = (b) => [b.id, r(b.x), r(b.y), b.d, b.rider ? 1 : 0, b.kind === 'raft' ? 1 : 0]
  // Une tombe : id, où ; le nom de qui y a laissé ses affaires, à part (id → nom).
  const tombRow = (t) => [t.id, t.x, t.y]
  const tombNames = (tombs) => Object.fromEntries(tombs.map((t) => [t.id, t.name]))
  const itemRow = (i) => [i.id, i.kind, i.x, i.y, i.n]
  // Ce qu'il y a dans un donjon : id, sorte, où, ouvert (un coffre), quand ses pointes sortent (en
  // dixièmes de seconde : voir `spiky`).
  const propRow = (p) => [p.id, PROP_KIND[p.kind], r(p.x), r(p.y), p.open ? 1 : 0, r(p.phase * 10)]
  const fireRow = (f) => [f.id, f.x, f.y, r(f.fuel), f.cooking.length]
  // Les noms des portails (id → nom), à part : les rangées ne sont que des nombres.
  const portalNames = (pieces) => Object.fromEntries(pieces.filter((p) => p.kind === 'portal').map((p) => [p.id, p.name]))
  // Ce qu'il y a dans les coffres (id → sorte → [nombre, qualité]), à part aussi.
  const chestStores = (pieces) => Object.fromEntries(pieces.filter((p) => p.kind === 'chest').map((p) => [p.id, Object.fromEntries(Object.entries(p.store).map(([k, n]) => [k, [n, p.quality[k] ?? 1]]))]))

  function me (client) {
    const p = world.players.get(client.id)
    if (!p) return
    const food = p.food.map((f) => [f.kind, r(f.until - world.time), FOODS[f.kind].time])
    send(client, { t: 'me', inv: p.inv, held: p.held, worn: p.worn, hp: r(p.hp), maxHp: world.maxHp(p), maxStamina: world.maxStamina(p), armor: world.armor(p), food, alive: p.alive, order: p.order, bed: !!p.bed, bedAt: p.bed ? [r(p.bed.x), r(p.bed.y)] : null, quality: p.quality, boat: p.boat })
  }

  function tick () {
    const t = Date.now()
    const dt = Math.min((t - last) / 1000, 0.2)
    last = t
    // Seul et en pause (le menu ouvert) : le monde attend.
    const all = ready()
    const paused = all.length === 1 && all[0].paused
    if (!paused) world.step(dt)
    const changes = world.changes()
    if (changes) {
      const msg = {
        t: 'o',
        trees: changes.trees.flatMap((x) => [x.id, x.stump ? 1 : 0]),
        // Les arbres nés d'une graine (tout entiers : le jeu ne les connaît pas encore).
        grown: changes.grown.flatMap(treeRow),
        rocks: changes.rocks.flatMap((x) => [x.id, x.gone ? 1 : 0]),
        bushes: changes.bushes.flatMap((x) => [x.id, x.ripe ? 1 : 0]),
        items: changes.items.flatMap(itemRow),
        fires: changes.fires.flatMap(fireRow),
        pieces: changes.pieces.flatMap(pieceRow),
        crops: changes.crops.flatMap(cropRow),
        boats: changes.boats.flatMap(boatRow),
        tombs: changes.tombs.flatMap(tombRow),
        tombNames: tombNames(changes.tombs),
        props: changes.props.flatMap(propRow),
        tilled: changes.tilled.flatMap((k) => [k % SIDE, Math.floor(k / SIDE)]),
        portals: portalNames(changes.pieces),
        chests: chestStores(changes.pieces),
        gone: changes.gone
      }
      for (const c of ready()) send(c, msg)
    }
    const told = new Set()
    for (const news of world.drain()) {
      if (news.t === 'fx' || news.t === 'boss') {
        for (const c of ready()) send(c, news)
      } else if (news.t === 'inv') {
        if (told.has(news.player)) continue
        told.add(news.player)
        const c = clientOf(news.player)
        if (c) me(c)
      } else if (news.t === 'got') {
        const c = clientOf(news.player)
        if (c) send(c, { t: 'got', kind: news.kind, n: news.n, quality: news.quality })
      } else if (news.t === 'dead') {
        const c = clientOf(news.player)
        if (c) {
          send(c, { t: 'dead', by: news.by })
          me(c)
        }
      } else if (news.t === 'respawn' || news.t === 'moved') {
        const c = clientOf(news.player)
        if (c) {
          const p = world.players.get(c.id)
          // Le donjon d'abord (le jeu change de plan), puis la position.
          crypt(c)
          send(c, { t: 'pos', x: r(p.x), y: r(p.y) })
          me(c)
        }
      }
    }
    for (const client of ready()) {
      scenery(client)
      if (client.ws.bufferedAmount < BUFFER_MAX) send(client, { ...frame(client), pz: [all.length === 1 ? 1 : 0, paused ? 1 : 0] })
    }
    if (t - saved > SAVE_EVERY) saveAll()
  }

  // Le donjon où est le joueur (son plan, ce qu'il y a dedans, ce qui y traîne), ou dehors.
  function crypt (client) {
    const p = world.players.get(client.id)
    const c = p && world.cryptAt(p.x, p.y)
    if (!c) return send(client, { t: 'crypt', id: null })
    const items = [...world.items.values()].filter((i) => world.cryptAt(i.x, i.y) === c)
    send(client, { t: 'crypt', id: c.id, ox: c.ox, oy: c.oy, side: c.d.side, tiles: c.d.tiles, props: c.d.props.flatMap(propRow), items: items.flatMap(itemRow) })
  }

  // Ce que voit le joueur : les joueurs (p : id, x, y, d, m, geste, son âge en dixièmes de seconde,
  // santé en %, en vie, ce qu'il tient (HELD, 0 : rien), ce qu'il porte (WORN), à bord d'un bateau (1), le bouclier levé (2), sur un radeau (4)...), les noms pas encore
  // vus (n : id → nom), les bêtes (b : id, sorte, x, y, d, état, santé en %, étoiles, un bouclier (1)...), les flèches (ar : x, y,
  // vx, vy, une lance lancée (1)...), sa santé (hp), Eikthyr s'il est là (boss : santé en %, x, y), les éclairs annoncés et les rochers des
  // trolls (bt : x, y, dixièmes de seconde avant qu'ils tombent, rayon, un rocher (1)...), l'heure du jour (clock : secondes depuis l'aube),
  // le sommeil (zz : endormi ou non, combien dorment, combien sont là), la pluie (rain : 1 s'il pleut),
  // l'heure du monde (tm, en secondes : les pointes des donjons en dépendent) ; `tick`
  // y ajoute la pause (pz : seul dans le monde, le monde en pause).
  function frame (client) {
    const self = world.players.get(client.id)
    const near = (o) => !self || Math.hypot(o.x - self.x, o.y - self.y) < VIEW
    const p = []
    const n = {}
    for (const o of world.players.values()) {
      if (!near(o)) continue
      const age = world.time - o.actAt
      const worn = Object.values(o.worn).reduce((bits, k) => bits | (WORN[k] ?? 0), 0)
      p.push(o.id, r(o.x), r(o.y), o.d, o.m, age < 1 ? ACT[o.act] ?? 0 : 0, r(age * 10), r((o.hp / world.maxHp(o)) * 100), o.alive ? 1 : 0, HELD[o.held] ?? 0, worn, (o.boat ? 1 : 0) | (o.guard !== null ? 2 : 0) | (world.boats.get(o.boat)?.kind === 'raft' ? 4 : 0))
      if (!client.known.has(o.id)) {
        client.known.add(o.id)
        n[o.id] = o.name
      }
    }
    const b = []
    for (const x of world.beasts.values()) {
      if (!near(x)) continue
      const eikthyr = x.kind === 'eikthyr'
      // L'élan (voir `dash`) : ramassée, puis lancée.
      // (Le troll qui soulève son rocher : comme un coup armé.)
      const rush = x.rush ? (world.time < x.rush.at ? STOMP : BEAST_STATE.charge) : x.toss ? STOMP : null
      const state = world.time < x.stun ? STUNNED : rush ?? (x.swing || (eikthyr && world.time - (x.stomp ?? -99) < 0.4) ? STOMP : world.time - (x.cast ?? -99) < 0.6 ? CAST : world.time - x.bit < 0.35 ? BITE : BEAST_STATE[x.state] ?? 0)
      b.push(x.id, BEAST_KIND[x.kind], r(x.x), r(x.y), x.d, state, r((x.hp / x.max) * 100), x.stars ?? 0, x.shield ? 1 : 0)
    }
    const ar = world.arrows.filter(near).flatMap((a) => [r(a.x), r(a.y), r(a.vx), r(a.vy), a.spear ? 1 : a.stone ? 2 : 0])
    const boss = world.boss()
    const bt = world.bolts.flatMap((v) => [r(v.x), r(v.y), Math.max(0, r((v.at - world.time) * 10)), v.rock ? v.radius : BOSS.boltRadius, v.rock ? 1 : 0])
    return { t: 's', p, n, b, ar, hp: self ? r(self.hp) : 0, boss: boss ? [r((boss.hp / boss.max) * 100), r(boss.x), r(boss.y)] : null, bt, clock: r(world.clock()), mn: Math.round(world.moon() * 100), zz: [self?.asleep ? 1 : 0, ...world.sleepers()], rain: world.weather.rain ? 1 : 0, tm: Math.round(world.time * 100) / 100 }
  }

  function start () {
    if (timer) return
    last = Date.now()
    timer = setInterval(tick, TICK_MS)
  }

  // Plus personne : le monde s'arrête (et attend tel quel), écrit dans la base.
  function idle () {
    if (clients.size || !timer) return
    clearInterval(timer)
    timer = null
    saveAll()
  }

  function ipOf (req) {
    const forwarded = trustProxy && req.headers['x-forwarded-for']
    return (forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress) || '?'
  }

  wss.on('connection', (ws, req) => {
    const ip = ipOf(req)
    const now = Date.now()
    const seen = ips.get(ip) ?? { open: 0, opened: [] }
    seen.opened = seen.opened.filter((at) => now - at < 60 * 1000)
    if (seen.open >= perIp || seen.opened.length >= perIpMinute) {
      ws.send(JSON.stringify({ t: 'error', error: 'Trop de connexions' }))
      ws.close(4002, 'Trop de connexions')
      return
    }
    seen.open++
    seen.opened.push(now)
    ips.set(ip, seen)
    const client = { ws, account: null, ready: false, id: null, known: new Set(), regions: new Set(), count: 0, second: 0 }
    clients.add(client)
    start()
    ws.on('message', (data) => {
      const t = Date.now()
      if (t - client.second > 1000) {
        client.second = t
        client.count = 0
      }
      if (++client.count > MESSAGES_MAX) return
      let msg
      try {
        msg = JSON.parse(data)
      } catch {
        return
      }
      if (!client.ready) {
        if (msg?.t === 'hello') hello(client, msg)
        return
      }
      command(client, msg, t)
    })
    ws.on('close', () => {
      seen.open--
      if (!seen.open && !seen.opened.length) ips.delete(ip)
      keep(client)
      if (client.id) world.leave(client.id)
      clients.delete(client)
      idle()
    })
    ws.on('error', () => {})
  })

  function command (client, msg, t) {
    const id = client.id
    if (!id) return
    switch (msg?.t) {
      case 'pos':
        if (!world.move(id, Number(msg.x), Number(msg.y), msg.d, msg.m)) {
          const p = world.players.get(id)
          if (p?.alive) send(client, { t: 'pos', x: r(p.x), y: r(p.y) })
        }
        break
      case 'hit':
        world.hit(id, !!msg.heavy)
        break
      case 'roll':
        world.roll(id)
        break
      case 'drown':
        world.drown(id)
        break
      case 'discard':
        world.discard(id, msg.k)
        break
      case 'jump':
        if (!world.jump(id, Number(msg.x), Number(msg.y))) {
          const p = world.players.get(id)
          if (p?.alive) send(client, { t: 'pos', x: r(p.x), y: r(p.y) })
        }
        break
      case 'shoot':
        world.shoot(id, Number(msg.a), msg.p === undefined ? 1 : Number(msg.p))
        break
      case 'pick':
        world.pick(id, msg.id)
        break
      case 'craft': {
        const why = world.craft(id, msg.r)
        if (why) send(client, { t: 'nope', why: `craft-${why}` })
        break
      }
      case 'place': {
        const why = world.place(id, msg.k, Number(msg.x), Number(msg.y), Number(msg.r) || 0)
        if (why) send(client, { t: 'nope', why: `place-${why}` })
        break
      }
      case 'upgrade': {
        const why = world.upgrade(id, msg.k)
        if (why) send(client, { t: 'nope', why: `upgrade-${why}` })
        break
      }
      case 'unbuild':
        world.unbuild(id, msg.id)
        break
      case 'use': {
        const why = world.use(id, msg.id)
        if (why) send(client, { t: 'nope', why: `use-${why}` })
        break
      }
      case 'name': {
        const why = world.name(id, msg.id, msg.name)
        if (why) send(client, { t: 'nope', why: `name-${why}` })
        break
      }
      case 'store': {
        const why = world.store(id, msg.id, msg.k, msg.n)
        if (why) send(client, { t: 'nope', why: `store-${why}` })
        break
      }
      case 'unstore': {
        const why = world.unstore(id, msg.id, msg.k, msg.n)
        if (why) send(client, { t: 'nope', why: `unstore-${why}` })
        break
      }
      case 'board': {
        const why = world.board(id, msg.id)
        if (why) send(client, { t: 'nope', why: `board-${why}` })
        break
      }
      case 'land': {
        const why = world.land(id)
        if (why) send(client, { t: 'nope', why: `land-${why}` })
        break
      }
      case 'block':
        world.block(id, !!msg.on)
        break
      case 'loot': {
        const why = world.loot(id, msg.id)
        if (why) send(client, { t: 'nope', why: `loot-${why}` })
        break
      }
      case 'harvest':
        world.harvest(id, msg.id)
        break
      case 'descend':
      case 'ascend':
      case 'open': {
        const why = msg.t === 'ascend' ? world.ascend(id) : world[msg.t](id, msg.id)
        if (why) send(client, { t: 'nope', why: `${msg.t}-${why}` })
        break
      }
      case 'build':
        if (!world.build(id, Number(msg.x), Number(msg.y))) send(client, { t: 'nope', why: 'build' })
        break
      case 'fuel':
        world.fuel(id, msg.id)
        break
      case 'cook':
        world.cook(id, msg.id)
        break
      case 'gather':
        world.gather(id, msg.id)
        break
      case 'wear':
        world.wear(id, msg.k)
        break
      case 'offer': {
        const why = world.offer(id)
        if (why) send(client, { t: 'nope', why: `offer-${why}` })
        break
      }
      case 'eat': {
        const why = world.eat(id, msg.k)
        if (why) send(client, { t: 'nope', why: `eat-${why}` })
        else me(client)
        break
      }
      case 'hold':
        world.hold(id, msg.k)
        break
      case 'order':
        world.arrange(id, msg.slots)
        break
      case 'respawn':
        world.respawn(id)
        break
      case 'ping':
        send(client, { t: 'pong', n: msg.n })
        break
      case 'pause':
        client.paused = !!msg.on
        break
      case 'say': {
        const text = clean(msg.text)
        if (!text || t - (client.said ?? 0) < SAY_EVERY) break
        client.said = t
        for (const c of ready()) send(c, { t: 'chat', from: client.account.name, text })
        break
      }
    }
  }

  function hello (client, msg) {
    const account = players.fromToken(msg.token)
    if (!account) return refuse(client, 'Joueur inconnu')
    if (!account.name) return refuse(client, 'Choisis d’abord un pseudo')
    // Une seule connexion par joueur : la nouvelle remplace l'ancienne.
    for (const other of clients) {
      if (other !== client && other.account?.id === account.id) {
        keep(other)
        if (other.id) world.leave(other.id)
        other.id = null
        other.ws.close(4000, 'Remplacé')
      }
    }
    let data = null
    try {
      data = JSON.parse(loadPlayer.get(account.id)?.data ?? 'null')
    } catch {}
    const p = world.join(account.name, { account: account.id, saved: data })
    Object.assign(client, { account, ready: true, id: p.id })
    send(client, {
      t: 'welcome',
      you: p.id,
      side: SIDE,
      tile: TILE,
      tiles: packed,
      relief,
      seed: world.seed,
      spawn: world.spawn,
      x: r(p.x),
      y: r(p.y),
      // Le décor vient ensuite, par zones (voir `scenery`).
      rocks: [],
      bushes: [],
      altar: world.altar,
      trees: [],
      items: [],
      fires: [...world.fires.values()].flatMap(fireRow),
      pieces: [...world.pieces.values()].flatMap(pieceRow),
      portals: portalNames([...world.pieces.values()]),
      chests: chestStores([...world.pieces.values()]),
      crops: [...world.crops.values()].flatMap(cropRow),
      // La terre retournée : x, y (en cases)...
      tilled: [...world.tilled].flatMap((k) => [k % SIDE, Math.floor(k / SIDE)]),
      boats: [...world.boats.values()].flatMap(boatRow),
      tombs: [...world.tombs.values()].flatMap(tombRow),
      tombNames: tombNames([...world.tombs.values()]),
      recipes: RECIPES,
      builds: BUILDS,
      foods: FOODS,
      // Le sac : la taille des piles (50 si rien n'est dit ; un pour ce qui se porte ou se tient), le
      // poids de chaque chose (1 si rien n'est dit), ce qu'on porte au plus.
      stacks: Object.fromEntries([...Object.keys(STACK), ...Object.keys(WEIGHT)].map((k) => [k, stackOf(k)])),
      weights: WEIGHT,
      carry: CARRY,
      // Ce qui s'améliore (la chose → la recette), jusqu'à quelle qualité.
      upgrades: Object.fromEntries(Object.entries(UPGRADES).map(([k, r]) => [k, r.id])),
      qualityMax: QUALITY_MAX,
      // Les mausolées des cryptes : id, où (le seuil de leur porte).
      crypts: world.crypts.flatMap((c) => [c.id, r(c.x), r(c.y)])
    })
    me(client)
    crypt(client)
    scenery(client)
  }

  // Les zones de décor autour du joueur qu'il n'a pas encore (voir REGION).
  function scenery (client) {
    const p = world.players.get(client.id)
    if (!p) return
    const [rx, ry] = [Math.floor(p.x / REGION), Math.floor(p.y / REGION)]
    const last = Math.ceil((SIDE * TILE) / REGION) - 1
    const out = { t: 'r', trees: [], rocks: [], bushes: [], items: [] }
    let any = false
    for (let j = Math.max(0, ry - 1); j <= Math.min(last, ry + 1); j++) {
      for (let i = Math.max(0, rx - 1); i <= Math.min(last, rx + 1); i++) {
        const key = j * 1000 + i
        if (client.regions.has(key)) continue
        client.regions.add(key)
        any = true
        const [x0, y0] = [i * REGION, j * REGION]
        const inside = (o) => o.x >= x0 && o.x < x0 + REGION && o.y >= y0 && o.y < y0 + REGION
        const [cx, cy] = [x0 + REGION / 2, y0 + REGION / 2]
        for (const t of world.grid.trees.near(cx, cy, REGION / 2)) if (inside(t)) out.trees.push(...treeRow(t))
        for (const k of world.grid.rocks.near(cx, cy, REGION / 2)) if (inside(k)) out.rocks.push(...rockRow(k))
        for (const b of world.bushes.values()) if (inside(b)) out.bushes.push(...bushRow(b))
        for (const x of world.items.values()) if (inside(x)) out.items.push(...itemRow(x))
      }
    }
    if (any) send(client, out)
  }

  function refuse (client, error) {
    send(client, { t: 'error', error })
    client.ws.close(4001, 'Refusé')
  }

  server.on('close', () => {
    if (timer) clearInterval(timer)
    saveAll()
    wss.close()
  })
  return { world, wss, save: saveAll }
}

module.exports = { ronnheim, PATH }
