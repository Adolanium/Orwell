/**
 * A long-lived LOCAL server plus the web build of this branch, for looking at things by hand.
 *
 *   node scripts/demo-servidor.mjs [frente=8492] [servidor=8493]
 *
 * One process: it starts a disposable homeserver (data in `.dev-data/demo-votacoes/`, which
 * git ignores) and serves `apps/web/dist` under `/app/` like the Caddy of production does,
 * proxying everything else (HTTP and WebSocket) to the homeserver. Stop it with SIGTERM
 * (the homeserver goes with it). It binds to 127.0.0.1 only and knows nothing about production.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const FRENTE = Number(process.argv[2] ?? 8492)
const SERVIDOR = Number(process.argv[3] ?? 8493)
const NOME = `localhost:${FRENTE}`
const DADOS = join(RAIZ, ".dev-data/demo-votacoes/servidor")
mkdirSync(DADOS, { recursive: true })

const servidor = spawn(process.execPath, [join(RAIZ, "apps/server/dist/main.js")], {
  env: {
    ...process.env,
    ENCLAVE_DATA_DIR: DADOS,
    ENCLAVE_SERVER_NAME: NOME,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(SERVIDOR),
    ENCLAVE_COMMUNITY_MODE: "true",
  },
  stdio: "inherit",
})
servidor.on("exit", () => process.exit(1))

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json", ".wasm": "application/wasm" }
const frente = http.createServer((pedido, resposta) => {
  const caminho = (pedido.url ?? "/").split("?")[0]
  if (caminho.startsWith("/app")) {
    const relativo = normalize(decodeURIComponent(caminho.slice("/app".length))).replace(/^(\.\.[/\\])+/, "")
    let ficheiro = join(DIST, relativo)
    if (!ficheiro.startsWith(DIST) || !existsSync(ficheiro) || statSync(ficheiro).isDirectory()) ficheiro = join(DIST, "index.html")
    resposta.writeHead(200, { "content-type": TIPOS[extname(ficheiro)] ?? "application/octet-stream", "cache-control": "no-cache" })
    resposta.end(readFileSync(ficheiro))
    return
  }
  const adiante = http.request({ host: "127.0.0.1", port: SERVIDOR, path: pedido.url, method: pedido.method, headers: pedido.headers }, (vinda) => {
    resposta.writeHead(vinda.statusCode ?? 502, vinda.headers)
    vinda.pipe(resposta)
  })
  adiante.on("error", () => {
    resposta.writeHead(502)
    resposta.end()
  })
  pedido.pipe(adiante)
})
frente.on("upgrade", (pedido, socket, cabeca) => {
  const destino = net.connect(SERVIDOR, "127.0.0.1", () => {
    const linhas = [`${pedido.method} ${pedido.url} HTTP/${pedido.httpVersion}`]
    for (let i = 0; i < pedido.rawHeaders.length; i += 2) linhas.push(`${pedido.rawHeaders[i]}: ${pedido.rawHeaders[i + 1]}`)
    destino.write(`${linhas.join("\r\n")}\r\n\r\n`)
    if (cabeca.length) destino.write(cabeca)
    socket.pipe(destino).pipe(socket)
  })
  destino.on("error", () => socket.destroy())
  socket.on("error", () => destino.destroy())
})
frente.listen(FRENTE, "127.0.0.1", () => console.log(`demo: http://127.0.0.1:${FRENTE}/app/`))
for (const sinal of ["SIGTERM", "SIGINT"]) process.on(sinal, () => { servidor.kill(); frente.close(); process.exit(0) })
