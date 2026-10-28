// Les jeux connus de floor. Chacun dit comment lire un score envoyé :
//   score(body) → { score, details } (lance une HttpError 400 si le score ne tient pas),
//   order : 'desc' quand le plus grand gagne, 'asc' quand c'est le plus petit (un temps...).
// Un nouveau jeu = un fichier ici, ajouté à la liste.
const games = [
  require('./speed-metal'),
  require('./puissance-4'),
  require('./ronnie-io'),
  require('./demineur'),
  require('./ronnie-run'),
  require('./riff-hero'),
  ...require('./riff-hero-solo'),
  require('./backstage')
]

module.exports = Object.fromEntries(games.map((g) => [g.id, g]))
