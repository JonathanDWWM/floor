const { HttpError } = require('../players')

// Un entier entre min et max, ou une erreur 400.
function int (body, key, min, max) {
  const v = body[key]
  if (!Number.isInteger(v) || v < min || v > max) throw new HttpError(400, `${key} : un entier entre ${min} et ${max}`)
  return v
}

// Riff Hero en solo : un morceau par niveau, le même pour tout le monde (Ronnie le fabrique d'une
// graine fixe), un classement par niveau. Le score est celui du morceau, le plus grand gagne. Les
// bornes écartent l'impossible (pas plus de 400 notes, à 400 points au plus chacune), pas la triche.
function level (id, name) {
  return {
    id,
    name,
    order: 'desc',
    score (body) {
      const details = {
        score: int(body, 'score', 1, 160000),
        hits: int(body, 'hits', 0, 400),
        perfects: int(body, 'perfects', 0, 400),
        misses: int(body, 'misses', 0, 400),
        combo: int(body, 'combo', 0, 400)
      }
      return { score: details.score, details }
    }
  }
}

module.exports = [
  level('riff-hero-facile', 'Riff Hero (facile)'),
  level('riff-hero-moyen', 'Riff Hero (moyen)'),
  level('riff-hero-difficile', 'Riff Hero (difficile)')
]
