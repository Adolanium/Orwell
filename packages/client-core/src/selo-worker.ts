import { selarTexto, type SeloEmCurso, type SeloPorFazer } from "./seloDoCofre.js"
import { decifrarBlob } from "./armazem/blob.js"
import type { RefDeMedia } from "./armazem/tipos.js"

/**
 * The vault seal, off the page thread.
 *
 * Each batched vault write was JSON, XChaCha20-Poly1305 and base64 of the whole
 * vault, on the page thread: on a slow laptop, 100 to 400 ms with the page
 * frozen, every second while messages arrive. The JSON (the snapshot) stays on
 * the page; the UTF-8 encoding, the cipher and the base64 run here.
 *
 * What crosses: the JSON text (one copy of a string), a COPY of the vault key
 * and the nonce; the sealed file buffer comes back moved, not copied. The key lives here only for one job and is zeroed after it.
 * Nothing else of the account crosses. This is the same origin and the same
 * process as the page: the threat model does not change (the page already
 * holds this key).
 *
 * Two halves in one file: `servirSelo` runs inside the Worker, `seladorNoWorker`
 * on the page. The web app gives the Worker its file (`apps/web/src/selo-worker.ts`).
 */

export type PedidoDeSelo =
  | { id: number; porFazer: SeloPorFazer; key: Uint8Array; nonce: Uint8Array }
  /** A media blob to open (the store's `decifrador`): the same thread, the same rule for the key. */
  | { id: number; blob: Uint8Array; key: Uint8Array; nonce: Uint8Array; sha: string; classe: RefDeMedia["c"] }
export type RespostaDeSelo = { id: number; selo: SeloEmCurso } | { id: number; bytes: Uint8Array } | { id: number; erro: string }

/** The scope a Worker gives: enough of it for this file, so tests can fake it. */
export interface EscopoDoSelo {
  onmessage: ((evento: { data: PedidoDeSelo }) => void) | null
  postMessage(mensagem: RespostaDeSelo, transferir?: Transferable[]): void
}

/** Inside the Worker: seal each job and send the buffer back (moved). */
export function servirSelo(escopo: EscopoDoSelo): void {
  escopo.onmessage = ({ data }) => {
    const { id, key, nonce } = data
    try {
      if ("blob" in data) {
        const bytes = decifrarBlob(data.blob, key, nonce, data.sha, data.classe)
        escopo.postMessage({ id, bytes }, [bytes.buffer as ArrayBuffer])
        return
      }
      const selo = selarTexto(data.porFazer, key, nonce)
      escopo.postMessage({ id, selo }, [selo.buffer.buffer as ArrayBuffer])
    } catch (erro) {
      escopo.postMessage({ id, erro: (erro as Error)?.message ?? String(erro) })
    } finally {
      key.fill(0)
    }
  }
}

/** The page side of a Worker: what `seladorNoWorker` needs. */
export interface TrabalhadorDoSelo {
  postMessage(mensagem: PedidoDeSelo, transferir: Transferable[]): void
  onmessage: ((evento: { data: RespostaDeSelo }) => void) | null
  onerror: ((evento: unknown) => void) | null
  terminate(): void
}

/**
 * On the page: a `SeladorDoCofre` that sends each job to one Worker.
 *
 * The Worker is born on the first job. If it cannot be born, or dies, the jobs
 * in flight fail (the session writes again on its next batch, as with any
 * failed write) and every later job is sealed here, on the page, as before.
 */
export function seladorNoWorker(
  criar: () => TrabalhadorDoSelo,
): (porFazer: SeloPorFazer, key: Uint8Array, nonce: Uint8Array) => Promise<SeloEmCurso> {
  let trabalhador: TrabalhadorDoSelo | null = null
  let partido = false
  let proximo = 1
  const emVoo = new Map<number, { resolver: (s: SeloEmCurso) => void; rejeitar: (e: Error) => void }>()
  const largar = (motivo: string): void => {
    partido = true
    trabalhador?.terminate()
    trabalhador = null
    for (const { rejeitar } of emVoo.values()) rejeitar(new Error(motivo))
    emVoo.clear()
  }
  return (porFazer, key, nonce) => {
    if (!partido && !trabalhador) {
      try {
        trabalhador = criar()
        trabalhador.onmessage = ({ data }) => {
          const pedido = emVoo.get(data.id)
          if (!pedido) return
          emVoo.delete(data.id)
          if ("erro" in data) pedido.rejeitar(new Error(data.erro))
          else if ("selo" in data) pedido.resolver(data.selo)
          else pedido.rejeitar(new Error("vault sealer answered something else"))
        }
        trabalhador.onerror = () => largar("vault sealer stopped")
      } catch {
        partido = true
        trabalhador = null
      }
    }
    if (partido || !trabalhador) {
      try {
        return Promise.resolve(selarTexto(porFazer, key, nonce))
      } catch (erro) {
        return Promise.reject(erro)
      } finally {
        key.fill(0)
      }
    }
    const id = proximo++
    const resposta = new Promise<SeloEmCurso>((resolver, rejeitar) => emVoo.set(id, { resolver, rejeitar }))
    trabalhador.postMessage({ id, porFazer, key, nonce }, [key.buffer as ArrayBuffer])
    return resposta
  }
}

/**
 * On the page: the media store's `decifrador`, on its own Worker of the same
 * file. The blob crosses as a copy (the store keeps its
 * own), the key as a copy, and the bytes come back moved. A Worker that cannot
 * be born or dies: every later blob opens here, on the page, as before.
 */
export function decifradorNoWorker(
  criar: () => TrabalhadorDoSelo,
): (blob: Uint8Array, k: Uint8Array, n: Uint8Array, sha: string, classe: RefDeMedia["c"]) => Promise<Uint8Array> {
  let trabalhador: TrabalhadorDoSelo | null = null
  let partido = false
  let proximo = 1
  const emVoo = new Map<number, { resolver: (b: Uint8Array) => void; rejeitar: (e: Error) => void }>()
  const largar = (motivo: string): void => {
    partido = true
    trabalhador?.terminate()
    trabalhador = null
    for (const { rejeitar } of emVoo.values()) rejeitar(new Error(motivo))
    emVoo.clear()
  }
  return (blob, k, n, sha, classe) => {
    if (!partido && !trabalhador) {
      try {
        trabalhador = criar()
        trabalhador.onmessage = ({ data }) => {
          const pedido = emVoo.get(data.id)
          if (!pedido) return
          emVoo.delete(data.id)
          if ("bytes" in data) pedido.resolver(data.bytes)
          else pedido.rejeitar(new Error("erro" in data ? data.erro : "media decrypter answered something else"))
        }
        trabalhador.onerror = () => largar("media decrypter stopped")
      } catch {
        partido = true
        trabalhador = null
      }
    }
    if (partido || !trabalhador) {
      try {
        return Promise.resolve(decifrarBlob(blob, k, n, sha, classe))
      } catch (erro) {
        return Promise.reject(erro)
      }
    }
    const id = proximo++
    const resposta = new Promise<Uint8Array>((resolver, rejeitar) => emVoo.set(id, { resolver, rejeitar }))
    const chave = k.slice()
    trabalhador.postMessage({ id, blob: blob.slice(), key: chave, nonce: n, sha, classe }, [chave.buffer as ArrayBuffer])
    return resposta
  }
}
