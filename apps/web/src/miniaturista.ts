import type { Miniaturista } from "@enclave/client-core"

/**
 * The web thumbnailer (design §3): `createImageBitmap` and `OffscreenCanvas`
 * in a Worker, so decoding a 12 MP photo does not stall the page.
 *
 * This file imports no values from `@enclave/client-core`: the worker
 * (`miniaturista-worker.ts`) imports `servirMiniaturas` from here, and the core
 * root would drag the session and the vault into it. That is why the side
 * length lives here, and a test pins it to `TECTOS_DO_ARMAZEM.ladoDaMiniatura`.
 */
export {
  dimensoesDaMiniatura,
  fazerMiniatura,
  LADO_DA_MINIATURA,
  portasDoBrowser,
  QUALIDADE_DA_MINIATURA,
  type ImagemDescodificada,
  type PortasDaMiniatura,
} from "./miniatura.js"
import { fazerMiniatura, portasDoBrowser, type PortasDaMiniatura } from "./miniatura.js"

/** A decode that does not finish within this gives null: the image has no thumbnail, like an unknown format. */
const TECTO_MS = 20_000

interface PedidoDeMiniatura {
  id: number
  bytes: Uint8Array
  tipo: string
}

interface RespostaDeMiniatura {
  id: number
  mini: { bytes: Uint8Array; tipo: string; w: number; h: number } | null
}

/** What `servirMiniaturas` needs from the worker scope. */
export interface EscopoDasMiniaturas {
  onmessage: ((evento: MessageEvent<PedidoDeMiniatura>) => void) | null
  postMessage(mensagem: RespostaDeMiniatura, transferir?: Transferable[]): void
}

/** The worker side: answers each request, by `id`. */
export function servirMiniaturas(escopo: EscopoDasMiniaturas, portas: PortasDaMiniatura = portasDoBrowser): void {
  escopo.onmessage = (evento) => {
    const { id, bytes, tipo } = evento.data
    void fazerMiniatura(bytes, tipo, portas).then((mini) => {
      escopo.postMessage({ id, mini }, mini ? [mini.bytes.buffer as ArrayBuffer] : [])
    })
  }
}

const criarWorkerDoBrowser = (): Worker | null => {
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return null
  try {
    return new Worker(new URL("./miniaturista-worker.ts", import.meta.url), { type: "module" })
  } catch {
    return null
  }
}

/**
 * The web `Miniaturista` port. A single worker, created on the first request;
 * if it dies, whoever was waiting gets null and the next request creates
 * another. Without Worker or without `OffscreenCanvas`, always null: the image
 * has no thumbnail, and the core treats it as a format it cannot decode.
 */
export function miniaturistaDaWeb(criarWorker: () => Worker | null = criarWorkerDoBrowser): Miniaturista {
  let worker: Worker | null = null
  let proximoId = 1
  const aEsperar = new Map<number, (mini: RespostaDeMiniatura["mini"]) => void>()

  const largarTodos = (): void => {
    worker?.terminate()
    worker = null
    const pendentes = [...aEsperar.values()]
    aEsperar.clear()
    for (const resolver of pendentes) resolver(null)
  }

  const arrancar = (): Worker | null => {
    if (worker) return worker
    worker = criarWorker()
    if (!worker) return null
    worker.onmessage = (evento: MessageEvent<RespostaDeMiniatura>) => {
      const resolver = aEsperar.get(evento.data.id)
      aEsperar.delete(evento.data.id)
      resolver?.(evento.data.mini)
    }
    worker.onerror = largarTodos
    worker.onmessageerror = largarTodos
    return worker
  }

  return {
    fazer: (bytes, tipo) => {
      if (!tipo.startsWith("image/")) return Promise.resolve(null)
      const trabalhador = arrancar()
      if (!trabalhador) return Promise.resolve(null)
      const id = proximoId++
      // A copy, transferred: the caller's bytes stay where they are.
      const copia = bytes.slice()
      return new Promise((resolver) => {
        const relogio = setTimeout(() => {
          aEsperar.delete(id)
          resolver(null)
        }, TECTO_MS)
        aEsperar.set(id, (mini) => {
          clearTimeout(relogio)
          resolver(mini)
        })
        const pedido: PedidoDeMiniatura = { id, bytes: copia, tipo }
        trabalhador.postMessage(pedido, [copia.buffer])
      })
    },
  }
}
