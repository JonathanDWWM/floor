const path = require('path')
const { open } = require('./db')
const { createApp } = require('./app')
const { blob } = require('./blob')
const { ronnheim } = require('./ronnheim')

const port = Number(process.env.PORT) || 5002
const file = process.env.FLOOR_DB || path.join(__dirname, '..', 'data', 'floor.db')
// Derrière un reverse proxy (nginx, Traefik...) : l'adresse du joueur vient de X-Forwarded-For.
const trustProxy = process.env.TRUST_PROXY ? (Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY) : false

const db = open(file)
// Les versions de Ronnheim, à côté de la base (dans le volume, en production) ; la publication veut
// le jeton RONNHEIM_PUBLISH_TOKEN (sans lui, fermée).
const releasesDir = process.env.RONNHEIM_RELEASES || path.join(path.dirname(file), 'ronnheim-releases')
const app = createApp(db, { trustProxy, releasesDir, publishToken: process.env.RONNHEIM_PUBLISH_TOKEN || null })
const server = app.listen(port, () => {
  console.log(`floor écoute sur le port ${port} (base : ${file})`)
})
const { wss } = blob(server, db, app.locals.players, { trustProxy })
// La graine d'un nouveau monde de Ronnheim (sinon au hasard) ; un monde en cours garde la sienne.
const seed = Number.isInteger(Number(process.env.RONNHEIM_SEED)) && process.env.RONNHEIM_SEED ? Number(process.env.RONNHEIM_SEED) : null
const game = ronnheim(server, db, app.locals.players, { trustProxy, seed })

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    // Les WebSockets ouverts empêcheraient le serveur de se fermer.
    for (const ws of [...wss.clients, ...game.wss.clients]) ws.terminate()
    server.close(() => {
      db.close()
      process.exit(0)
    })
  })
}
