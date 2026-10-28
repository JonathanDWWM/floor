const { HttpError } = require('../players')

// Un entier entre min et max, ou une erreur 400.
function int (body, key, min, max) {
  const v = body[key]
  if (!Number.isInteger(v) || v < min || v > max) throw new HttpError(400, `${key} : un entier entre ${min} et ${max}`)
  return v
}

// Backstage : dans les coulisses, ramasser des médiators sans se faire attraper par Krog, qui s'énerve tous
// les 10 médiators et appelle ses copains. Le score : 10 par médiator, fois 1 + la fureur de Krog ; le plus
// grand gagne. Les bornes écartent l'impossible, pas la triche.
module.exports = {
  id: 'backstage',
  name: 'Backstage',
  order: 'desc',
  score (body) {
    const details = {
      score: int(body, 'score', 10, 10000000),
      rage: int(body, 'rage', 0, 2000),
      picks: int(body, 'picks', 1, 20000)
    }
    return { score: details.score, details }
  }
}
