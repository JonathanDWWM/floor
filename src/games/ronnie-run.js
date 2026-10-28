const { HttpError } = require('../players')

// Un entier entre min et max, ou une erreur 400.
function int (body, key, min, max) {
  const v = body[key]
  if (!Number.isInteger(v) || v < min || v > max) throw new HttpError(400, `${key} : un entier entre ${min} et ${max}`)
  return v
}

// Ronnie Run : un chanteur court sur scène, de plus en plus vite, et saute par-dessus le matos. Le
// score est la distance en mètres, le plus grand gagne. Les bornes écartent l'impossible (plus d'une
// heure à la vitesse la plus haute), pas la triche.
module.exports = {
  id: 'ronnie-run',
  name: 'Ronnie Run',
  order: 'desc',
  score (body) {
    const details = {
      meters: int(body, 'meters', 1, 150000),
      jumps: int(body, 'jumps', 0, 100000)
    }
    return { score: details.meters, details }
  }
}
