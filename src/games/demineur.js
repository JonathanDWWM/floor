const { HttpError } = require('../players')

// Un entier entre min et max, ou une erreur 400.
function int (body, key, min, max) {
  const v = body[key]
  if (!Number.isInteger(v) || v < min || v > max) throw new HttpError(400, `${key} : un entier entre ${min} et ${max}`)
  return v
}

// Le démineur de Ronnie : une grille de 16 × 16 et 40 mines, déminée le plus vite possible. Le score
// est le temps en millisecondes, le plus petit gagne. Les bornes écartent l'impossible, pas la triche.
module.exports = {
  id: 'demineur',
  name: 'Démineur',
  order: 'asc',
  score (body) {
    const details = {
      ms: int(body, 'ms', 1000, 3600000),
      clicks: int(body, 'clicks', 1, 2000)
    }
    return { score: details.ms, details }
  }
}
