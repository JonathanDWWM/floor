// Les WebSockets de floor : chaque jeu prend son chemin sur le serveur HTTP (deux WebSocketServer de
// `ws` posés sur le même serveur refuseraient chacun les connexions de l'autre). Un chemin inconnu est refusé.
const routes = new WeakMap()

function route (server, path, wss) {
  let paths = routes.get(server)
  if (!paths) {
    paths = new Map()
    routes.set(server, paths)
    server.on('upgrade', (req, socket, head) => {
      const wss = paths.get(req.url.split('?')[0])
      if (!wss) {
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    })
  }
  paths.set(path, wss)
}

module.exports = { route }
