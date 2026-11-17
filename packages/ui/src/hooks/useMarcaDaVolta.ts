import { useEffect, useRef } from "react"
import type { ConnectionState, ContadoresDeDiagnostico, EnclaveBridge } from "../bridge.js"
import { recordDiagnostic } from "../lib/diagnostics.js"

/** How long after the return the mark keeps measuring. The owner's freeze was about 5 s. */
export const JANELA_DA_VOLTA_MS = 10_000

/** What one return to the foreground measured. Mechanics only: never content. */
export interface MedidaDaVolta {
  escondidaMs: number
  /** The page's own long tasks (> 50 ms) in the window, summed, and how many. `null`: the browser does not report them. */
  presaMs: number | null
  tarefasLongas: number | null
  /** The difference between two counter readings (start and end of the window). `null`: the bridge has no counters. */
  contadores: ContadoresDeDiagnostico | null
  /** How long the first counter reading took to come back: on the desktop, a held main process answers late. */
  respostaMs: number | null
  /** The connection during the window. */
  ligacao: "estavel" | "caiu-e-voltou" | "caiu"
}

/** The log line, `chave=valor` separated by spaces, so a pasted log reads as is. */
export function detalheDaVolta(medida: MedidaDaVolta): string {
  const partes = [`escondida=${Math.round(medida.escondidaMs / 1000)}s`]
  if (medida.presaMs !== null) partes.push(`presa=${Math.round(medida.presaMs)}ms`, `longas=${medida.tarefasLongas}`)
  if (medida.contadores) {
    partes.push(`cofre=${medida.contadores.gravacoesDoCofre}`, `atrasados=${medida.contadores.temporizadoresAtrasados}`)
    if (medida.contadores.temporizadoresAtrasados > 0) partes.push(`maiorAtraso=${Math.round(medida.contadores.maiorAtrasoMs / 1000)}s`)
    if (medida.contadores.principalPresoMs !== undefined) partes.push(`principal=${medida.contadores.principalPresoMs}ms`)
  }
  if (medida.respostaMs !== null) partes.push(`resposta=${Math.round(medida.respostaMs)}ms`)
  partes.push(`ligacao=${medida.ligacao}`)
  return partes.join(" ")
}

/** The counters' change between two readings. The main-process delay is already "since the last reading". */
function diferenca(antes: ContadoresDeDiagnostico, depois: ContadoresDeDiagnostico): ContadoresDeDiagnostico {
  return {
    gravacoesDoCofre: depois.gravacoesDoCofre - antes.gravacoesDoCofre,
    temporizadoresAtrasados: depois.temporizadoresAtrasados - antes.temporizadoresAtrasados,
    maiorAtrasoMs: depois.temporizadoresAtrasados > antes.temporizadoresAtrasados ? depois.maiorAtrasoMs : 0,
    ...(depois.principalPresoMs !== undefined ? { principalPresoMs: depois.principalPresoMs } : {}),
  }
}

/** Sums the page's long tasks while it lives. Without `longtask` support (Firefox, Safari), nothing. */
function observarTarefasLongas(): { ler: () => { ms: number; n: number }; parar: () => void } | null {
  const Observador = globalThis.PerformanceObserver
  if (typeof Observador !== "function" || !Observador.supportedEntryTypes?.includes("longtask")) return null
  let ms = 0
  let n = 0
  const observador = new Observador((lista) => {
    for (const tarefa of lista.getEntries()) {
      ms += tarefa.duration
      n++
    }
  })
  observador.observe({ type: "longtask" })
  return {
    ler: () => ({ ms, n }),
    parar: () => observador.disconnect(),
  }
}

/**
 * A mark in the diagnostic log at each return to the foreground (1.3.15).
 *
 * The Windows app (1.3.14) froze for about 5 s when restored from
 * minimized, and it does not happen headless. The log that the person copies
 * now says, for the `JANELA_DA_VOLTA_MS` after each return: how long the page
 * was held (its long tasks, summed), how many times the vault was written, how
 * many core timers fired late, on the desktop how long the main process was
 * held and how long it took to answer, and whether the connection dropped and
 * came back. Nothing about the messages.
 */
export function useMarcaDaVolta(bridge: EnclaveBridge, ativo: boolean, connection: ConnectionState): void {
  const ligacao = useRef(connection)
  const caiu = useRef(false)
  useEffect(() => {
    ligacao.current = connection
    if (connection !== "online") caiu.current = true
  }, [connection])

  useEffect(() => {
    if (!ativo || typeof document === "undefined") return
    let escondidaEm: number | null = document.visibilityState === "hidden" ? Date.now() : null
    let fechar: (() => void) | null = null

    const comecar = (): void => {
      const desde = escondidaEm
      escondidaEm = null
      if (desde === null) return
      const voltouEm = Date.now()
      caiu.current = ligacao.current !== "online"
      const longas = observarTarefasLongas()
      const ler = bridge.diagnostico?.contadores
      const pedidoEm = performance.now()
      const inicio = ler ? ler().then((c) => ({ c, respostaMs: performance.now() - pedidoEm })).catch(() => null) : Promise.resolve(null)
      let acabado = false
      const acabar = (): void => {
        if (acabado) return
        acabado = true
        clearTimeout(relogio)
        const tarefas = longas?.ler() ?? null
        longas?.parar()
        const queda = caiu.current
        const fim = ler ? ler().catch(() => null) : Promise.resolve(null)
        void Promise.all([inicio, fim]).then(([a, b]) => {
          const medida: MedidaDaVolta = {
            escondidaMs: voltouEm - desde,
            presaMs: tarefas ? tarefas.ms : null,
            tarefasLongas: tarefas ? tarefas.n : null,
            contadores: a && b ? diferenca(a.c, b) : null,
            respostaMs: a ? a.respostaMs : null,
            ligacao: !queda ? "estavel" : ligacao.current === "online" ? "caiu-e-voltou" : "caiu",
          }
          recordDiagnostic({ kind: "action", code: "foreground", detail: detalheDaVolta(medida) })
        })
      }
      const relogio = setTimeout(acabar, JANELA_DA_VOLTA_MS)
      fechar = acabar
    }

    const aoMudar = (): void => {
      if (document.visibilityState === "visible") {
        comecar()
        return
      }
      // Hidden again inside the window: what was measured goes to the log now.
      fechar?.()
      fechar = null
      escondidaEm ??= Date.now()
    }
    document.addEventListener("visibilitychange", aoMudar)
    return () => {
      document.removeEventListener("visibilitychange", aoMudar)
      fechar?.()
    }
  }, [bridge, ativo])
}
