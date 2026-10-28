// Les donjons des cryptes : sous chaque mausolée de la forêt noire, un escalier descend dans un donjon
// à part (hors de l'île : on y est emmené), tiré d'une graine. Des salles sur une grille de GRID × GRID
// cases (quelques-unes manquent), reliées par des couloirs de deux cases de large, une porte (une case
// ouverte dans le mur) à chaque bout. La salle de l'entrée (l'escalier qui remonte) est en bas ; la plus
// loin d'elle garde le trésor ; les autres ont chacune leur rôle : des squelettes, un générateur de
// squelettes, un coffre, des pièges à pointes. Ici, rien que le plan : world.js le pose et le fait vivre.

// Une case de la grille fait CELL cases de côté ; une salle y tient avec au moins deux cases de mur
// autour (assez pour qu'un couloir coudé passe entre deux salles).
const CELL = 16
const GRID = 4
const SIDE = GRID * CELL + 1
// Les cases du plan : le mur, le sol, une porte (du sol, où la vue s'arrête : voir `zones`).
const WALL = '8'
const FLOOR = '9'
const DOOR = 'a'
// Les rôles des salles (en plus de l'entrée et du trésor), les premiers toujours là s'il y a la place.
const ROLES = ['spawner', 'trap', 'treasure', 'guard']
const MORE_ROLES = ['guard', 'guard', 'treasure', 'trap', 'spawner', 'empty']

function generate (random) {
  const int = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1))
  const pick = (list) => list[Math.floor(random() * list.length)]
  const tiles = new Array(SIDE * SIDE).fill(WALL)
  const set = (x, y, t) => { tiles[y * SIDE + x] = t }
  const at = (x, y) => tiles[y * SIDE + x]

  // Les cases de la grille : toutes, moins quelques-unes (le reste se tient), l'entrée en bas.
  const key = (c, r) => r * GRID + c
  const active = new Set(Array.from({ length: GRID * GRID }, (_, k) => k))
  const entry = key(int(0, GRID - 1), GRID - 1)
  const near = (k) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dc, dr]) => [k % GRID + dc, Math.floor(k / GRID) + dr]).filter(([c, r]) => c >= 0 && r >= 0 && c < GRID && r < GRID).map(([c, r]) => key(c, r))
  const linked = () => {
    const seen = new Set([entry])
    const todo = [entry]
    while (todo.length) for (const n of near(todo.pop())) if (active.has(n) && !seen.has(n)) seen.add(n) && todo.push(n)
    return seen.size === active.size
  }
  for (let holes = int(3, 6), tries = 0; holes > 0 && tries < 50; tries++) {
    const k = pick([...active])
    if (k === entry) continue
    active.delete(k)
    if (linked()) holes--
    else active.add(k)
  }

  // Une salle par case, de taille et de place au hasard dans sa case.
  const rooms = new Map()
  for (const k of active) {
    const [c, r] = [k % GRID, Math.floor(k / GRID)]
    const w = int(5, CELL - 6)
    const h = int(4, CELL - 7)
    const x0 = c * CELL + 2 + int(0, CELL - 4 - w)
    const y0 = r * CELL + 2 + int(0, CELL - 4 - h)
    rooms.set(k, { k, x0, y0, x1: x0 + w - 1, y1: y0 + h - 1, links: [] })
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, FLOOR)
  }

  // Les passages : un arbre au hasard depuis l'entrée (chaque salle se rejoint), plus quelques boucles.
  const edges = []
  const seen = new Set([entry])
  const todo = [entry]
  while (todo.length) {
    const k = todo[todo.length - 1]
    const next = near(k).filter((n) => active.has(n) && !seen.has(n))
    if (!next.length) {
      todo.pop()
      continue
    }
    const n = pick(next)
    edges.push([k, n])
    seen.add(n)
    todo.push(n)
  }
  for (const k of active) {
    for (const n of near(k)) {
      if (n > k && active.has(n) && !edges.some(([a, b]) => (a === k && b === n) || (a === n && b === k)) && random() < 0.25) edges.push([k, n])
    }
  }

  // Un couloir entre deux salles voisines : droit si elles se font face, sinon coudé au milieu. `along`
  // va d'une salle à l'autre, `across` est l'autre sens (le couloir y fait deux cases de large).
  const corridors = []
  const carve = (horizontal, a, b) => {
    const put = (u, v, t) => (horizontal ? set(u, v, t) : set(v, u, t))
    const [a0, a1, b0, b1] = horizontal ? [a.y0, a.y1, b.y0, b.y1] : [a.x0, a.x1, b.x0, b.x1]
    const [from, to] = horizontal ? [a.x1 + 1, b.x0 - 1] : [a.y1 + 1, b.y0 - 1]
    const lo = Math.max(a0, b0)
    const hi = Math.min(a1, b1)
    const cells = []
    const dig = (u, v) => {
      put(u, v, FLOOR)
      cells.push(horizontal ? [u, v] : [v, u])
    }
    let [va, vb] = [0, 0]
    if (hi - lo >= 1) {
      va = vb = int(lo, hi - 1)
      for (let u = from; u <= to; u++) for (const v of [va, va + 1]) dig(u, v)
    } else {
      va = int(a0, a1 - 1)
      vb = int(b0, b1 - 1)
      const mid = int(from + 1, to - 2)
      for (let u = from; u <= mid + 1; u++) for (const v of [va, va + 1]) dig(u, v)
      for (let v = Math.min(va, vb); v <= Math.max(va, vb) + 1; v++) for (const u of [mid, mid + 1]) dig(u, v)
      for (let u = mid; u <= to; u++) for (const v of [vb, vb + 1]) dig(u, v)
    }
    for (const v of [va, va + 1]) put(from, v, DOOR)
    for (const v of [vb, vb + 1]) put(to, v, DOOR)
    corridors.push({ cells: cells.filter(([x, y]) => at(x, y) === FLOOR), straight: hi - lo >= 1, horizontal })
  }
  for (const [k, n] of edges) {
    const [a, b] = k < n ? [rooms.get(k), rooms.get(n)] : [rooms.get(n), rooms.get(k)]
    a.links.push(b.k)
    b.links.push(a.k)
    carve(Math.abs(k - n) === 1, a, b)
  }

  // La profondeur de chaque salle depuis l'entrée : la plus loin garde le trésor.
  const depth = new Map([[entry, 0]])
  const queue = [entry]
  while (queue.length) {
    const k = queue.shift()
    for (const n of rooms.get(k).links) if (!depth.has(n)) depth.set(n, depth.get(k) + 1) && queue.push(n)
  }
  const others = [...rooms.keys()].filter((k) => k !== entry).sort((a, b) => depth.get(b) - depth.get(a) || a - b)
  const roles = new Map([[entry, 'entry']])
  if (others.length) roles.set(others[0], 'vault')
  const rest = others.slice(1)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  rest.forEach((k, i) => roles.set(k, i < ROLES.length ? ROLES[i] : pick(MORE_ROLES)))

  // Ce qu'il y a dans chaque salle (en cases) : les accessoires (props) et les bêtes.
  const props = []
  const beasts = []
  const taken = new Set()
  const prop = (kind, x, y, extra = {}) => {
    taken.add(y * SIDE + x)
    props.push({ kind, x, y, ...extra })
  }
  // Une case libre de la salle, loin des portes (pour ne pas boucher un passage).
  const free = (room, margin = 1) => {
    for (let k = 0; k < 40; k++) {
      const x = int(room.x0 + margin, room.x1 - margin)
      const y = int(room.y0 + margin, room.y1 - margin)
      const byDoor = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]].some(([dx, dy]) => at(x + dx, y + dy) === DOOR)
      if (!taken.has(y * SIDE + x) && !byDoor) return [x, y]
    }
    return null
  }
  // Des squelettes, dont tant d'archers.
  const skeletons = (room, n, archers = 0) => {
    for (let i = 0; i < n; i++) {
      const spot = free(room)
      if (spot) beasts.push({ kind: i < archers ? 'archer' : 'skeleton', x: spot[0], y: spot[1] })
    }
  }
  const centre = (room) => [Math.floor((room.x0 + room.x1) / 2), Math.floor((room.y0 + room.y1) / 2)]
  // Contre le mur du haut, pas sous une porte (ni à côté), au plus près du milieu.
  const backWall = (room) => {
    const walled = (x) => [x - 1, x, x + 1].every((u) => at(u, room.y0 - 1) === WALL)
    const xs = Array.from({ length: room.x1 - room.x0 - 1 }, (_, i) => room.x0 + 1 + i).filter(walled)
    const cx = centre(room)[0]
    return xs.sort((a, b) => Math.abs(a - cx) - Math.abs(b - cx))[0] ?? cx
  }
  for (const [k, role] of roles) {
    const room = rooms.get(k)
    room.role = role
    const [cx, cy] = centre(room)
    if (role === 'entry') {
      // L'escalier qui remonte ; on arrive juste devant.
      const sx = backWall(room)
      prop('stairs', sx, room.y0)
      room.arrive = [sx, Math.min(room.y0 + 2, room.y1)]
      for (const x of [sx - 1, sx + 1]) taken.add(room.y0 * SIDE + x)
      taken.add((room.y0 + 1) * SIDE + sx)
    } else if (role === 'vault') {
      // Le trésor est gardé : un squelette à deux étoiles devant le coffre, un archer, un générateur.
      const vx = backWall(room)
      prop('vault', vx, room.y0 + 1)
      prop('spawner', cx, cy + 1 <= room.y1 - 1 ? cy + 1 : cy)
      beasts.push({ kind: 'skeleton', x: vx, y: Math.min(room.y0 + 3, room.y1), stars: 2 })
      taken.add(Math.min(room.y0 + 3, room.y1) * SIDE + vx)
      skeletons(room, 1, 1)
    } else if (role === 'spawner') {
      prop('spawner', cx, cy)
      skeletons(room, 1, 1)
    } else if (role === 'treasure') {
      const spot = free(room)
      if (spot) prop('coffer', ...spot)
      skeletons(room, int(1, 2))
    } else if (role === 'guard') {
      skeletons(room, int(2, 3), int(0, 1))
      for (let i = int(1, 3); i > 0; i--) {
        const spot = free(room, 0)
        if (spot) prop('bones', ...spot)
      }
    } else if (role === 'trap') {
      // Des pointes qui sortent du sol tour à tour : en rangées, en damier ou en croix (une vague les
      // parcourt : on passe en guettant le bon moment). Un coffre au bout, pour la peine.
      const pattern = int(0, 2)
      for (let y = room.y0; y <= room.y1; y++) {
        for (let x = room.x0; x <= room.x1; x++) {
          const on = pattern === 0 ? (y - room.y0) % 2 === 1 : pattern === 1 ? (x + y) % 2 === 0 : x === cx || y === cy
          if (on && !taken.has(y * SIDE + x)) prop('spikes', x, y, { phase: ((x - room.x0) * 0.35 + (y - room.y0) * 0.2) % 3 })
        }
      }
      const corner = pick([[room.x0, room.y0], [room.x1, room.y0], [room.x0, room.y1], [room.x1, room.y1]])
      const i = props.findIndex((p) => p.x === corner[0] && p.y === corner[1])
      if (i >= 0) props.splice(i, 1)
      prop('coffer', ...corner)
    } else {
      for (let i = int(2, 4); i > 0; i--) {
        const spot = free(room, 0)
        if (spot) prop('bones', ...spot)
      }
    }
    // Des braseros contre le mur du haut (la lumière), sauf dans les salles vides, qu'il faut éclairer
    // soi-même.
    if (role === 'empty') continue
    for (const x of [room.x0 + 1, room.x1 - 1]) {
      if (at(x, room.y0 - 1) === WALL && !taken.has(room.y0 * SIDE + x) && (role !== 'trap' || random() < 0.5)) prop('brazier', x, room.y0)
    }
  }
  // Quelques couloirs droits piégés : une bande de pointes en travers.
  for (const c of corridors) {
    if (!c.straight || c.cells.length < 6 || random() > 0.3) continue
    const mid = c.cells[Math.floor(c.cells.length / 2)]
    for (const [x, y] of c.cells) {
      if ((c.horizontal ? x === mid[0] : y === mid[1]) && !taken.has(y * SIDE + x)) prop('spikes', x, y, { phase: 0 })
    }
  }
  return { side: SIDE, tiles: tiles.join(''), rooms: [...rooms.values()], entry: rooms.get(entry), props, beasts, zones: zones(tiles) }
}

// Les espaces du donjon : chaque salle, chaque couloir (du sol d'un seul tenant, entre des portes) a son
// numéro ; une porte n'en a pas (-1, on y voit des deux côtés), un mur non plus (-2).
function zones (tiles) {
  const out = new Int16Array(SIDE * SIDE).fill(-2)
  let next = 0
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === DOOR) out[i] = -1
    if (tiles[i] !== FLOOR || out[i] !== -2) continue
    out[i] = next
    const todo = [i]
    while (todo.length) {
      const k = todo.pop()
      for (const n of [k + 1, k - 1, k + SIDE, k - SIDE]) {
        if (n >= 0 && n < tiles.length && tiles[n] === FLOOR && out[n] === -2) {
          out[n] = next
          todo.push(n)
        }
      }
    }
    next++
  }
  return out
}

module.exports = { generate, CELL, GRID, SIDE, WALL, FLOOR, DOOR }
