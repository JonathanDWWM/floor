const { HttpError } = require('../players')

// Riff Hero, en battle à deux sur floor (voir src/live) : le classement compte les victoires, que
// floor enregistre lui-même à la fin des battles.
module.exports = {
  id: 'riff-hero',
  name: 'Riff Hero',
  order: 'desc',
  score () {
    throw new HttpError(403, 'Les victoires sont comptées par floor')
  }
}
