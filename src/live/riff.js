const crypto = require('crypto')

// Le battle de guitares de Riff Hero : les deux joueurs jouent le même morceau (la même graine, Ronnie
// en tire la partition et le son) au même moment, chacun chez soi. Ronnie envoie où il en est en cours
// de morceau ; le plus haut score à la fin gagne, et prend le public.

// Le compte à rebours avant la première note, et la longueur du morceau (le tempo et les mesures de
// Ronnie, src/riff.rs, avec de quoi finir).
const LEAD_MS = 5 * 1000
const SONG_MS = 62 * 1000
// Les retardataires ont tant après la fin pour envoyer leur score final.
const GRACE_MS = 10 * 1000

// Les bornes écartent l'impossible, pas la triche.
const MAX = { score: 2000000, combo: 2000, hits: 2000, misses: 2000 }

// Où en est un joueur au début.
const fresh = () => ({ score: 0, combo: 0, hits: 0, misses: 0, done: false })

// Une graine de 31 bits (un entier sûr des deux côtés).
const seed = () => crypto.randomInt(1, 2 ** 31)

// Ce que Ronnie envoie, vérifié ; une erreur (RangeError) sinon.
function progress (body) {
  const out = { done: body?.done === true }
  for (const [key, max] of Object.entries(MAX)) {
    const v = body?.[key]
    if (!Number.isInteger(v) || v < 0 || v > max) throw new RangeError(`${key} : un entier entre 0 et ${max}`)
    out[key] = v
  }
  return out
}

// Le gagnant, 1 ou 2 (3 : égalité), aux scores.
function winner (sides) {
  const [a, b] = sides.map((s) => s.score)
  return a === b ? 3 : a > b ? 1 : 2
}

module.exports = { LEAD_MS, SONG_MS, GRACE_MS, fresh, seed, progress, winner }
