/**
 * A disposable homeserver behind a front that acts as Caddy, with a slow link
 * you can switch on: the place where phone scripts run.
 *
 * The front has two layers. Inside, an HTTP server that serves the web as
 * production does (gzip, `immutable` assets, `no-cache` entry) and proxies the
 * gateway. Outside, a TCP pipe that paces bytes like a phone link: half the
 * round trip each way, and one shared bandwidth per direction for all
 * connections. At TCP level it covers the bundle AND the WebSocket, in every
 * engine (WebKit and Firefox have no CDP throttling).
 *
 * Used by `medir-arranque-telemovel.mjs` and `e2e-telemovel-paridade.mjs`.
 * ALL LOCAL: the database lives in a temp folder deleted on `fechar`, ports are
 * checked free first, and nothing here can point at production.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
export const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")

/** Slow 4G, as Lighthouse defines it. */
export const REDE_4G_LENTA = { rttMs: 150, baixarBps: 1_600_000 / 8, subirBps: 750_000 / 8 }

async function portaLivre(porta) {
  return new Promise((r) => {
    const sonda = net.createServer()
    sonda.once("error", () => r(false))
    sonda.once("listening", () => sonda.close(() => r(true)))
    sonda.listen(porta, "127.0.0.1")
  })
}

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json", ".wasm": "application/wasm" }

export async function levantarServidor({ dist, portaDaFrente, portaDoServidor, rede = REDE_4G_LENTA, prefixo = "orwell-frente-lenta-" }) {
  const portaInterna = portaDaFrente + 100
  for (const caminho of [join(dist, "index.html"), SERVIDOR_JS]) {
    if (!existsSync(caminho)) throw new Error(`Falta ${caminho}. Corre \`npm run build\` primeiro.`)
  }
  for (const porta of [portaDaFrente, portaInterna, portaDoServidor]) {
    if (!(await portaLivre(porta))) throw new Error(`A porta ${porta} já tem dono. Este guião não mata processos de ninguém.`)
  }
  const nome = `localhost:${portaDaFrente}`
  const salaComum = `!orwell:${nome}`
  const dados = mkdtempSync(join(tmpdir(), prefixo))
  const servidor = spawn(process.execPath, [SERVIDOR_JS], {
    env: {
      ...process.env,
      ENCLAVE_DATA_DIR: dados,
      ENCLAVE_SERVER_NAME: nome,
      ENCLAVE_BIND_HOST: "127.0.0.1",
      ENCLAVE_BIND_PORT: String(portaDoServidor),
      ENCLAVE_COMMUNITY_MODE: "true",
      ENCLAVE_COMMON_ROOM: salaComum,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let registo = ""
  servidor.stdout.on("data", (b) => (registo += b))
  servidor.stderr.on("data", (b) => (registo += b))

  const comprimidos = new Map()
  const interna = http.createServer((pedido, resposta) => {
    const caminho = (pedido.url ?? "/").split("?")[0]
    if (caminho.startsWith("/app")) {
      const relativo = normalize(decodeURIComponent(caminho.slice("/app".length))).replace(/^(\.\.[/\\])+/, "")
      let ficheiro = join(dist, relativo)
      if (!ficheiro.startsWith(dist) || !existsSync(ficheiro) || statSync(ficheiro).isDirectory()) ficheiro = join(dist, "index.html")
      const tipo = TIPOS[extname(ficheiro)] ?? "application/octet-stream"
      const cache = caminho.startsWith("/app/assets/") ? "public, max-age=31536000, immutable" : "no-cache"
      const aceitaGzip = /gzip/.test(String(pedido.headers["accept-encoding"] ?? ""))
      let corpo = readFileSync(ficheiro)
      const cabecalhos = { "content-type": tipo, "cache-control": cache }
      if (aceitaGzip && /text|json|javascript|svg|wasm/.test(tipo)) {
        if (!comprimidos.has(ficheiro)) comprimidos.set(ficheiro, gzipSync(corpo))
        corpo = comprimidos.get(ficheiro)
        cabecalhos["content-encoding"] = "gzip"
      }
      cabecalhos["content-length"] = corpo.length
      resposta.writeHead(200, cabecalhos)
      resposta.end(corpo)
      return
    }
    const adiante = http.request({ host: "127.0.0.1", port: portaDoServidor, path: pedido.url, method: pedido.method, headers: pedido.headers }, (vinda) => {
      resposta.writeHead(vinda.statusCode ?? 502, vinda.headers)
      vinda.pipe(resposta)
    })
    adiante.on("error", () => {
      resposta.writeHead(502)
      resposta.end()
    })
    pedido.pipe(adiante)
  })
  interna.on("upgrade", (pedido, socket, cabeca) => {
    const destino = net.connect(portaDoServidor, "127.0.0.1", () => {
      const linhas = [`${pedido.method} ${pedido.url} HTTP/${pedido.httpVersion}`]
      for (let i = 0; i < pedido.rawHeaders.length; i += 2) linhas.push(`${pedido.rawHeaders[i]}: ${pedido.rawHeaders[i + 1]}`)
      destino.write(`${linhas.join("\r\n")}\r\n\r\n`)
      if (cabeca.length) destino.write(cabeca)
      socket.pipe(destino).pipe(socket)
    })
    destino.on("error", () => socket.destroy())
    socket.on("error", () => destino.destroy())
  })
  await new Promise((r) => interna.listen(portaInterna, "127.0.0.1", r))

  /*
    The paced pipe: each chunk leaves after half the round trip, and after the
    chunks ahead of it on the same direction's shared link have drained at its
    bandwidth. One queue and one timer per pipe, so order never depends on
    timer ordering. While the link is fast, chunks pass straight through (after
    any still queued).
  */
  const estado = { lenta: false, bytesDescidos: 0 }
  const descida = { livreEm: 0, bps: rede.baixarBps }
  const subida = { livreEm: 0, bps: rede.subirBps }
  function ritmar(origem, destino, ligacao) {
    const fila = []
    let relogio = null
    const drenar = () => {
      relogio = null
      const agora = Date.now()
      while (fila.length && fila[0].quando <= agora) {
        const { bocado, fim } = fila.shift()
        if (fim) destino.end()
        else destino.write(bocado)
      }
      if (fila.length) relogio = setTimeout(drenar, fila[0].quando - agora)
    }
    const por = (entrada) => {
      fila.push(entrada)
      if (!relogio) relogio = setTimeout(drenar, Math.max(0, fila[0].quando - Date.now()))
    }
    const ultima = () => (fila.length ? fila[fila.length - 1].quando : 0)
    origem.on("data", (bocado) => {
      if (!estado.lenta) {
        if (fila.length === 0) return void destino.write(bocado)
        return por({ bocado, quando: ultima() })
      }
      const agora = Date.now()
      ligacao.livreEm = Math.max(ligacao.livreEm, agora) + (bocado.length * 1000) / ligacao.bps
      por({ bocado, quando: Math.max(ligacao.livreEm + rede.rttMs / 2, ultima()) })
    })
    origem.on("end", () => por({ fim: true, quando: Math.max(Date.now(), ultima()) }))
    origem.on("error", () => destino.destroy())
  }
  const frente = net.createServer((cliente) => {
    const dentro = net.connect(portaInterna, "127.0.0.1")
    dentro.on("data", (b) => (estado.bytesDescidos += estado.lenta ? b.length : 0))
    ritmar(cliente, dentro, subida)
    ritmar(dentro, cliente, descida)
    cliente.on("error", () => dentro.destroy())
    dentro.on("error", () => cliente.destroy())
    cliente.on("close", () => dentro.destroy())
    dentro.on("close", () => cliente.destroy())
  })
  await new Promise((r) => frente.listen(portaDaFrente, "127.0.0.1", r))

  for (let volta = 0; volta < 60; volta++) {
    const ok = await new Promise((r) => {
      const s = net.connect(portaDoServidor, "127.0.0.1", () => (s.destroy(), r(true)))
      s.on("error", () => r(false))
    })
    if (ok) break
    await new Promise((r) => setTimeout(r, 250))
  }

  return {
    /** Drop the gzip cache: for a script that swaps the web under the same origin. */
    esquecerFicheiros: () => comprimidos.clear(),
    nome,
    salaComum,
    app: `http://${nome}/app/?lingua=pt`,
    dados,
    base: join(dados, "enclave.sqlite"),
    rede,
    registo: () => registo,
    redeLenta: (ligada) => {
      estado.lenta = ligada
      if (ligada) estado.bytesDescidos = 0
    },
    bytesDescidos: () => estado.bytesDescidos,
    fechar: () => {
      frente.close()
      interna.close()
      servidor.kill()
      rmSync(dados, { recursive: true, force: true })
    },
  }
}
