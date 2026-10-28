// Les versions de Ronnheim (le jeu se met à jour depuis floor, son dépôt GitHub étant privé). La
// publication (GitHub Actions, voir le dépôt ronnheim) envoie chaque archive puis publie la version ;
// le jeu demande la dernière, et télécharge l'archive de son système, qu'il vérifie avec son empreinte.
//
// Rangées dans `dir` (le volume de la base, en production) : <version>/<archive>, et latest.json (la
// version publiée, ses notes, ses archives avec leur taille et leur SHA-256). Les deux versions
// d'avant restent, les autres partent.
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const express = require('express')
const { HttpError } = require('./players')

// Une archive fait quelques Mo : au-delà, ce n'est pas la nôtre.
const MAX = 300 * 1024 * 1024
const KEEP = 3
const VERSION = /^\d+\.\d+\.\d+$/
const ARCHIVE = /^ronnheim-[a-z0-9_]+(-[a-z0-9_]+)*\.(tar\.gz|zip)$/

// Les versions dans l'ordre (la plus récente d'abord).
const newest = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]
}

function releases ({ dir, token = null } = {}) {
  const router = express.Router()
  const latest = () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8'))
    } catch {
      return null
    }
  }
  // La publication : seulement avec le jeton (sans lui configuré, fermée).
  const publisher = (req, res, next) => {
    const given = (req.get('authorization') ?? '').replace(/^Bearer /, '')
    const ok = token && given.length === token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token))
    next(ok ? undefined : new HttpError(401, 'Jeton de publication refusé'))
  }
  const check = (req) => {
    if (!VERSION.test(req.params.version)) throw new HttpError(400, 'Version invalide (X.Y.Z)')
    if (req.params.name !== undefined && !ARCHIVE.test(req.params.name)) throw new HttpError(400, 'Nom d’archive invalide')
  }

  router.get('/release', (req, res) => {
    const release = latest()
    if (!release) throw new HttpError(404, 'Aucune version publiée')
    res.json(release)
  })

  router.get('/download/:version/:name', (req, res, next) => {
    check(req)
    const file = path.join(dir, req.params.version, req.params.name)
    if (!fs.existsSync(file)) throw new HttpError(404, 'Archive introuvable')
    res.sendFile(file, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' } }, (err) => err && next(err))
  })

  // Une archive de la version à venir : le corps tel quel, écrit à côté puis renommé.
  router.put('/releases/:version/:name', publisher, (req, res, next) => {
    check(req)
    const into = path.join(dir, req.params.version)
    fs.mkdirSync(into, { recursive: true })
    const temp = path.join(into, `.${req.params.name}.${process.pid}.part`)
    const out = fs.createWriteStream(temp)
    let size = 0
    let failed = false
    const fail = (err) => {
      if (failed) return
      failed = true
      out.destroy()
      fs.rm(temp, { force: true }, () => next(err))
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX) {
        req.destroy()
        fail(new HttpError(413, 'Archive trop grosse'))
      }
    })
    req.on('error', fail)
    out.on('error', fail)
    req.pipe(out)
    out.on('finish', () => {
      if (failed) return
      fs.renameSync(temp, path.join(into, req.params.name))
      res.status(201).json({ name: req.params.name, size })
    })
  })

  // La version envoyée devient la dernière : ses archives, avec leur empreinte, et ses notes.
  router.post('/releases/:version/publish', publisher, express.json({ limit: '64kb' }), (req, res) => {
    check(req)
    const into = path.join(dir, req.params.version)
    const names = fs.existsSync(into) ? fs.readdirSync(into).filter((n) => ARCHIVE.test(n)) : []
    if (!names.length) throw new HttpError(400, 'Aucune archive envoyée pour cette version')
    const files = names.map((name) => {
      const bytes = fs.readFileSync(path.join(into, name))
      return { name, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
    })
    const release = { version: req.params.version, notes: typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 20000) : '', at: new Date().toISOString(), files }
    const temp = path.join(dir, `.latest.${process.pid}.json`)
    fs.writeFileSync(temp, JSON.stringify(release, null, 2))
    fs.renameSync(temp, path.join(dir, 'latest.json'))
    // Les plus vieilles versions partent.
    const versions = fs.readdirSync(dir).filter((v) => VERSION.test(v)).sort(newest)
    for (const old of versions.slice(KEEP)) if (old !== release.version) fs.rmSync(path.join(dir, old), { recursive: true, force: true })
    res.status(201).json(release)
  })

  return router
}

module.exports = { releases }
