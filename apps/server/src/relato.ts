import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises"
import { join } from "node:path"
import { CorpoDoRelato, RELATO_MAX_BYTES, ROTA_DO_RELATO } from "@enclave/protocol"
import type { FastifyInstance } from "fastify"
import { verificarPedidoAssinado, type NoncesVistos } from "./pedido-assinado.js"
import type { Store } from "./store.js"

/**
 * "Enviar registo" (send log; Help and diagnostics, phase 4 of the 0.9 settings).
 *
 * The app sends the session's diagnostic log (the same text as "Copiar registo",
 * which holds no messages and no user text) with the version. The server keeps
 * it in one file per day and per address, for 30 days, so the server operator
 * can read it when the user describes the problem.
 *
 * **The route lives under `/_enclave/`**, not under `/relato` at the root: in
 * production the reverse proxy only passes to the server what is under
 * `/_enclave/*`, and the page CSP already allows `fetch` to the same origin
 * (`connect-src 'self'`).
 *
 * **Signed request** (`pedido-assinado.ts`, the same as the report routes):
 * the device of an open session signs it, the chain links the device to the
 * account, the account must have logged in here before, and a revoked device
 * is refused. The address written in the file is proven, not claimed. Before
 * 1.3.15 the route was open; an old app now gets a 401, which it already shows
 * as "the server did not take the log".
 *
 * **Caps** protect the disk: 64 kB per log, 10 per hour per address, and 30 per
 * hour per IP. The IP is only counted in memory, never written. None of this
 * goes into the access log.
 */

export { RELATO_MAX_BYTES }
/** How many logs per hour, per address. */
export const RELATOS_POR_HORA = 10
/** How many logs per hour, per IP: the cap a declared address cannot get around. */
export const RELATOS_POR_HORA_POR_IP = 30
/** How many days a log is kept. */
export const RELATO_DIAS = 30

const HORA_MS = 3_600_000
const DIA_MS = 24 * HORA_MS

/**
 * A sliding one-hour window, per key. In memory: a restart starts the count over, and that is enough.
 *
 * `janelaMs` extends it: suspension review requests count per day (`denuncia.ts`).
 */
export class JanelaDeUmaHora {
  readonly #vezes = new Map<string, number[]>()
  constructor(
    readonly maximo: number,
    readonly janelaMs = HORA_MS,
  ) {}

  /** Counts one more, if there is still room. Returns whether it fit. */
  tentar(chave: string, agora = Date.now()): boolean {
    const recentes = (this.#vezes.get(chave) ?? []).filter((quando) => agora - quando < this.janelaMs)
    if (recentes.length >= this.maximo) {
      this.#vezes.set(chave, recentes)
      return false
    }
    recentes.push(agora)
    this.#vezes.set(chave, recentes)
    return true
  }

  /** Forgets keys with nothing in the last window, so the map does not grow forever. */
  limpar(agora = Date.now()): void {
    for (const [chave, vezes] of this.#vezes) {
      if (vezes.every((quando) => agora - quando >= this.janelaMs)) this.#vezes.delete(chave)
    }
  }
}

/**
 * The short address, for the file name: the local part, only letters, numbers,
 * `-` and `_`. The full address goes inside the file, in the header of each
 * log; the name only needs to be safe and readable.
 */
export function enderecoCurto(endereco: string): string {
  const local = endereco.slice(1, endereco.indexOf(":") > 0 ? endereco.indexOf(":") : undefined)
  const limpo = local.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 32)
  return limpo || "anonimo"
}

/** `2026-10-28`, in UTC: the same day for whoever reads it on the server, whatever the sender's timezone. */
export function dataDoFicheiro(agora: Date): string {
  return agora.toISOString().slice(0, 10)
}

/**
 * The `corpo` of the signed request, already validated. `null` is a malformed
 * body. The 64 kB cap is checked apart, in UTF-8 bytes (`texto.length` counts
 * UTF-16 units), so an oversized log gets its own answer.
 */
export function lerCorpoDoRelato(corpo: unknown): CorpoDoRelato | null {
  const lido = CorpoDoRelato.safeParse(corpo)
  return lido.success ? lido.data : null
}

/** Deletes logs older than `RELATO_DIAS`. A failure on one file does not stop the others. */
export async function varrerRelatos(pasta: string, agora = Date.now()): Promise<number> {
  let apagados = 0
  let nomes: string[]
  try {
    nomes = await readdir(pasta)
  } catch {
    return 0
  }
  for (const nome of nomes) {
    if (!nome.endsWith(".txt")) continue
    const caminho = join(pasta, nome)
    try {
      const { mtimeMs } = await stat(caminho)
      if (agora - mtimeMs > RELATO_DIAS * DIA_MS) {
        await unlink(caminho)
        apagados += 1
      }
    } catch {
      // Another sweep deleted it meanwhile, or it cannot be read: leave it for the next one.
    }
  }
  return apagados
}

/**
 * Registers `POST /_enclave/relato` and the daily sweep. Returns a function that
 * stops the sweep (the server's `close` calls it).
 */
export function registarRelatos(
  app: FastifyInstance,
  deps: { dataDir: string; store: Store; serverName: string; nonces: NoncesVistos },
): () => void {
  const pasta = join(deps.dataDir, "relatos")
  const porEndereco = new JanelaDeUmaHora(RELATOS_POR_HORA)
  const porIp = new JanelaDeUmaHora(RELATOS_POR_HORA_POR_IP)

  app.post(
    ROTA_DO_RELATO,
    // The signed envelope wraps JSON with the text inside: well above the 64 kB
    // of text, for escaped characters and the rest of the object. The exact cap is below.
    { bodyLimit: RELATO_MAX_BYTES * 8 },
    async (request, reply) => {
      // The body first, so a bad one does not spend a slot of the cap or a nonce.
      // Tampering with it after signing still fails the signature below.
      const corpo = lerCorpoDoRelato((request.body as { corpo?: unknown } | null)?.corpo)
      const verificado = verificarPedidoAssinado(request.body, ROTA_DO_RELATO, {
        store: deps.store,
        serverName: deps.serverName,
        nonces: deps.nonces,
        // IP first: many accounts on the same machine cannot get around the cap.
        tecto: (endereco) => corpo !== null && porIp.tentar(request.ip) && porEndereco.tentar(endereco),
      })
      if (!verificado.ok) {
        return reply.code(401).send({ error: verificado.razao === "stale-request" ? "stale-request" : "unauthorized" })
      }
      if (!corpo) return reply.code(400).send({ error: "malformed-report" })
      if (Buffer.byteLength(corpo.texto, "utf8") > RELATO_MAX_BYTES) {
        return reply.code(413).send({ error: "report-too-large" })
      }
      if (!verificado.coube) return reply.code(429).send({ error: "too-many-reports" })
      const agora = new Date()
      const ficheiro = join(pasta, `${dataDoFicheiro(agora)}-${enderecoCurto(verificado.endereco)}.txt`)
      const cabecalho = `--- ${agora.toISOString()} · ${verificado.endereco} · versão ${corpo.versao}\n`
      await mkdir(pasta, { recursive: true })
      await appendFile(ficheiro, `${cabecalho}${corpo.texto}\n\n`, { encoding: "utf8", mode: 0o600 })
      return { ok: true }
    },
  )

  void varrerRelatos(pasta)
  const varrimento = setInterval(() => {
    porEndereco.limpar()
    porIp.limpar()
    void varrerRelatos(pasta)
  }, 6 * HORA_MS)
  varrimento.unref()
  return () => clearInterval(varrimento)
}
