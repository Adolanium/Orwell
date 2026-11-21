#!/usr/bin/env node
/**
 * Proves, against real Caddy, that a server restart is a wait and not a 502 (1.3.26).
 *
 *   node scripts/provar-caddy-espera.mjs                 # caddy from PATH
 *   CADDY=/path/to/caddy node scripts/provar-caddy-espera.mjs
 *
 * Runs infra/Caddyfile as it is, with two substitutions in a temporary copy: the
 * upstream `server:8448` becomes a local port, and the site address a local one.
 * A stand-in server (plain HTTP plus a WebSocket, not the real one) opens its port
 * only after a delay, the way the real server does while it starts. Three proofs:
 *
 *   1. GET /_enclave/health sent while nothing listens: 200 once the port opens.
 *   2. A WebSocket to /_enclave/gateway opened while nothing listens: connects and
 *      gets the first message once the port opens.
 *   3. With nothing ever listening: 502, after about 30 s and not before (the bound).
 *
 * Touches nothing outside a temporary folder and two loopback ports.
 */
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { WebSocket, WebSocketServer } from "ws"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const CADDY = process.env.CADDY || "caddy"
const PORTA_CADDY = 18081
const PORTA_SERVIDOR = 18449
const ATRASO_MS = 3000

const pasta = mkdtempSync(join(tmpdir(), "orwell-caddy-espera-"))
const original = readFileSync(join(RAIZ, "infra/Caddyfile"), "utf8")
if (!original.includes("reverse_proxy server:8448")) throw new Error("infra/Caddyfile já não aponta para server:8448")
writeFileSync(join(pasta, "Caddyfile"), original.replace("reverse_proxy server:8448", `reverse_proxy 127.0.0.1:${PORTA_SERVIDOR}`))

const caddy = spawn(CADDY, ["run", "--config", join(pasta, "Caddyfile"), "--adapter", "caddyfile"], {
  env: { ...process.env, ENCLAVE_SITE_ADDRESS: `:${PORTA_CADDY}`, XDG_DATA_HOME: pasta, XDG_CONFIG_HOME: pasta },
  stdio: ["ignore", "ignore", "pipe"],
})
let registoDoCaddy = ""
caddy.stderr.on("data", (bocado) => (registoDoCaddy += bocado))

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms))
const base = `http://127.0.0.1:${PORTA_CADDY}`

/** A stand-in server that opens its port after `atraso` ms. Returns a function that closes it. */
function servidorAtrasado(atraso) {
  const http = createServer((pedido, resposta) => {
    if (pedido.url === "/_enclave/health") return resposta.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}')
    resposta.writeHead(404).end()
  })
  const ws = new WebSocketServer({ server: http, path: "/_enclave/gateway" })
  ws.on("connection", (socket) => socket.send("ola"))
  const temporizador = setTimeout(() => http.listen(PORTA_SERVIDOR, "127.0.0.1"), atraso)
  return () =>
    new Promise((resolver) => {
      clearTimeout(temporizador)
      for (const cliente of ws.clients) cliente.terminate()
      ws.close()
      http.close(() => resolver())
      if (!http.listening) resolver()
    })
}

let falhas = 0
function prova(descricao, certo, detalhe) {
  process.stdout.write(`${certo ? "ok  " : "FALHA"}  ${descricao}  (${detalhe})\n`)
  if (!certo) falhas += 1
}

try {
  // Caddy up (its own page answers, whatever the code).
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${base}/`)
      break
    } catch {
      await esperar(100)
    }
  }

  {
    const fechar = servidorAtrasado(ATRASO_MS)
    const inicio = Date.now()
    const resposta = await fetch(`${base}/_enclave/health`)
    const ms = Date.now() - inicio
    prova("health pedido com o servidor em baixo responde quando a porta abre", resposta.status === 200 && ms >= ATRASO_MS - 300, `${resposta.status} ao fim de ${ms} ms`)
    await fechar()
  }

  {
    const fechar = servidorAtrasado(ATRASO_MS)
    const inicio = Date.now()
    const resultado = await new Promise((resolver) => {
      const socket = new WebSocket(`ws://127.0.0.1:${PORTA_CADDY}/_enclave/gateway`)
      socket.on("message", (dados) => {
        resolver(String(dados))
        socket.close()
      })
      socket.on("error", (erro) => resolver(`erro: ${erro.message}`))
      socket.on("unexpected-response", (_pedido, resposta) => resolver(`http ${resposta.statusCode}`))
    })
    const ms = Date.now() - inicio
    prova("WebSocket aberto com o servidor em baixo liga quando a porta abre", resultado === "ola", `${resultado} ao fim de ${ms} ms`)
    await fechar()
  }

  {
    const inicio = Date.now()
    const resposta = await fetch(`${base}/_enclave/health`)
    const ms = Date.now() - inicio
    prova("sem servidor nenhum, 502 ao fim de cerca de 30 s", resposta.status === 502 && ms >= 29_000 && ms < 40_000, `${resposta.status} ao fim de ${ms} ms`)
  }
} finally {
  caddy.kill()
  rmSync(pasta, { recursive: true, force: true })
}

if (falhas > 0) {
  process.stderr.write(`\n${falhas} prova(s) falharam. Registo do Caddy:\n${registoDoCaddy.slice(-4000)}\n`)
  process.exit(1)
}
process.stdout.write("\nTodas as provas passaram.\n")
