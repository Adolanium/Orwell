import { randomBytes } from "node:crypto"
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { BUGS_POR_DIA, CorpoDoBug, ROTA_DOS_BUGS } from "@enclave/protocol"
import type { FastifyInstance } from "fastify"
import type { ServerConfig } from "./config.js"
import { verificarPedidoAssinado, type NoncesVistos } from "./pedido-assinado.js"
import { JanelaDeUmaHora } from "./relato.js"
import type { Store } from "./store.js"

/**
 * "Report a bug" (12/11/2026), on the server side: `POST /_enclave/bug`.
 *
 * The same mould as the reports (`denuncia.ts`), in its own folder: `<dados>/bugs/`,
 * one file per report, and `fila.json` with only numbers and dates, which the
 * operator's alert reads by SSH. Outside the database, so the backup that leaves
 * the VPS does not carry them.
 *
 * **Authenticated by a signed request** (`pedido-assinado.ts`), so the daily cap
 * counts real accounts. The address is stored ONLY when the person checks "Let us
 * contact you"; otherwise it counts and is forgotten.
 *
 * Caps: 5 per day per account, 20 per day per IP, 16 kB per body, 2 000 open
 * files in the folder. Kept 90 days.
 */

/** The largest body stored, in JSON bytes. A full form stays well below. */
export const BUG_MAX_BYTES = 16 * 1024
/** Bug reports per day, per IP: many accounts on one machine do not get around the cap. */
export const BUGS_POR_DIA_POR_IP = 20
/** How many reports the folder holds at most. Past this, new ones get 507 until the sweep or the operator clears it. */
export const BUGS_NA_PASTA_MAX = 2_000
/** Days a report is kept. */
export const BUGS_DIAS = 90

const DIA_MS = 24 * 3_600_000
const NOME_DO_BUG = /^(\d+)\.json$/

export interface BugGuardado {
  v: 1
  numero: number
  /** ISO 8601, to the millisecond. */
  recebido: string
  /** Only with `contacto`. */
  contacto?: string
  corpo: CorpoDoBug
}

/** What the alert reads: numbers and dates, never the description. */
export interface FilaDosBugs {
  v: 1
  bugs: { numero: number; recebido: string; comContacto: boolean }[]
  actualizada: string
}

async function escreverAtomico(caminho: string, conteudo: string): Promise<void> {
  const temporario = `${caminho}.${randomBytes(6).toString("hex")}.tmp`
  await writeFile(temporario, conteudo, { encoding: "utf8", mode: 0o600 })
  await rename(temporario, caminho)
}

/** The bugs folder. Writes go through a serial queue, so two requests do not take the same number. */
export class ArquivoDeBugs {
  #emSerie: Promise<unknown> = Promise.resolve()

  constructor(readonly pasta: string) {}

  #emFila<T>(tarefa: () => Promise<T>): Promise<T> {
    const resultado = this.#emSerie.then(tarefa, tarefa)
    this.#emSerie = resultado.catch(() => undefined)
    return resultado
  }

  async #nomes(): Promise<string[]> {
    try {
      return (await readdir(this.pasta)).filter((nome) => NOME_DO_BUG.test(nome))
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === "ENOENT") return []
      throw erro
    }
  }

  async listar(): Promise<BugGuardado[]> {
    const lidos: BugGuardado[] = []
    for (const nome of await this.#nomes()) {
      try {
        lidos.push(JSON.parse(await readFile(join(this.pasta, nome), "utf8")) as BugGuardado)
      } catch {
        // Unreadable: skipped, the others still count.
      }
    }
    return lidos.sort((a, b) => a.numero - b.numero)
  }

  /** Stores with the next number, or `null` when the folder is full. Rewrites `fila.json`. */
  guardar(bug: Omit<BugGuardado, "numero">): Promise<BugGuardado | null> {
    return this.#emFila(async () => {
      await mkdir(this.pasta, { recursive: true, mode: 0o700 })
      const nomes = await this.#nomes()
      if (nomes.length >= BUGS_NA_PASTA_MAX) return null
      const numero = nomes.reduce((maior, nome) => Math.max(maior, Number(NOME_DO_BUG.exec(nome)?.[1] ?? 0)), 0) + 1
      const guardado: BugGuardado = { ...bug, numero }
      await escreverAtomico(join(this.pasta, `${numero}.json`), `${JSON.stringify(guardado, null, 2)}\n`)
      await this.#escreverFila()
      return guardado
    })
  }

  /** Deletes what is older than `dias` and rewrites the queue. Returns how many left. */
  varrer(agora = Date.now(), dias = BUGS_DIAS): Promise<number> {
    return this.#emFila(async () => {
      let apagados = 0
      for (const bug of await this.listar()) {
        const recebido = Date.parse(bug.recebido)
        if (Number.isFinite(recebido) && agora - recebido <= dias * DIA_MS) continue
        await unlink(join(this.pasta, `${bug.numero}.json`)).then(
          () => (apagados += 1),
          () => undefined,
        )
      }
      if (apagados > 0) await this.#escreverFila()
      return apagados
    })
  }

  async #escreverFila(): Promise<void> {
    const bugs = (await this.listar()).map(({ numero, recebido, contacto }) => ({ numero, recebido, comContacto: contacto !== undefined }))
    const fila: FilaDosBugs = { v: 1, bugs, actualizada: new Date().toISOString() }
    await escreverAtomico(join(this.pasta, "fila.json"), `${JSON.stringify(fila, null, 2)}\n`)
  }
}

export function registarBugs(
  app: FastifyInstance,
  deps: { store: Store; config: ServerConfig; nonces: NoncesVistos },
): () => void {
  const arquivo = new ArquivoDeBugs(join(deps.config.dataDir, "bugs"))
  const porConta = new JanelaDeUmaHora(BUGS_POR_DIA, DIA_MS)
  const porIp = new JanelaDeUmaHora(BUGS_POR_DIA_POR_IP, DIA_MS)

  app.post(ROTA_DOS_BUGS, { bodyLimit: BUG_MAX_BYTES + 4 * 1024 }, async (request, reply) => {
    const verificado = verificarPedidoAssinado(request.body, ROTA_DOS_BUGS, {
      store: deps.store,
      serverName: deps.config.serverName,
      nonces: deps.nonces,
      tecto: (endereco) => porIp.tentar(request.ip) && porConta.tentar(endereco),
    })
    if (!verificado.ok) {
      return reply.code(401).send({ error: verificado.razao === "stale-request" ? "stale-request" : "unauthorized" })
    }
    const corpo = CorpoDoBug.safeParse(verificado.corpo)
    if (!corpo.success) return reply.code(400).send({ error: "malformed-bug" })
    if (Buffer.byteLength(JSON.stringify(corpo.data), "utf8") > BUG_MAX_BYTES) return reply.code(413).send({ error: "bug-too-large" })
    if (!verificado.coube) return reply.code(429).send({ error: "too-many-bugs" })
    const guardado = await arquivo.guardar({
      v: 1,
      recebido: new Date().toISOString(),
      ...(corpo.data.contacto ? { contacto: verificado.endereco } : {}),
      corpo: corpo.data,
    })
    if (!guardado) return reply.code(507).send({ error: "bug-queue-full" })
    return { ok: true }
  })

  const varrer = (): void => {
    void arquivo.varrer().catch((erro: unknown) => {
      process.stderr.write(`enclave: varrimento dos bugs falhou: ${(erro as Error)?.message ?? erro}\n`)
    })
  }
  varrer()
  const varrimento = setInterval(() => {
    porConta.limpar()
    porIp.limpar()
    varrer()
  }, 6 * 3_600_000)
  varrimento.unref()
  return () => clearInterval(varrimento)
}
