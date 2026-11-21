import { provaCumpre } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import { resolverNumTrabalhador, servirProvaDeTrabalho, type TrabalhadorDaProva } from "./prova-worker.js"

/**
 * The proof of work off the main thread (1.3.26). A Web Worker in the browser
 * and in the desktop app's window; here, a worker in the same thread that
 * speaks the same messages, so the test reads what the page reads.
 */
function trabalhadorFalso(): TrabalhadorDaProva & { terminado: boolean } {
  const escopo = { onmessage: null as ((evento: { data: unknown }) => void) | null, postMessage: (_m: unknown) => {} }
  const trabalhador = {
    onmessage: null as ((evento: { data: unknown }) => void) | null,
    onerror: null as ((evento: unknown) => void) | null,
    terminado: false,
    postMessage(dados: unknown) {
      setTimeout(() => escopo.onmessage?.({ data: dados }), 0)
    },
    terminate() {
      this.terminado = true
    },
  }
  escopo.postMessage = (mensagem) => trabalhador.onmessage?.({ data: mensagem })
  servirProvaDeTrabalho(escopo)
  return trabalhador
}

describe("a prova de trabalho num trabalhador", () => {
  it("resolve, diz o progresso até 1, e termina o trabalhador", async () => {
    let criado: ReturnType<typeof trabalhadorFalso> | null = null
    const resolver = resolverNumTrabalhador(() => (criado = trabalhadorFalso()))
    const progresso: number[] = []
    const prova = await resolver({ desafio: "v1.teste", trabalho: 30_000 }, (f) => progresso.push(f))
    expect(provaCumpre("v1.teste", prova.nonce, 30_000)).toBe(true)
    expect(progresso.at(-1)).toBe(1)
    expect(criado!.terminado).toBe(true)
  })

  it("sem trabalhador (o anfitrião não o consegue criar), resolve nesta thread", async () => {
    const resolver = resolverNumTrabalhador(() => {
      throw new Error("no worker here")
    })
    const prova = await resolver({ desafio: "v1.sem", trabalho: 100 })
    expect(provaCumpre("v1.sem", prova.nonce, 100)).toBe(true)
  })

  it("um trabalhador que falha a meio dá lugar a esta thread", async () => {
    const resolver = resolverNumTrabalhador(() => {
      const t = trabalhadorFalso()
      t.postMessage = () => setTimeout(() => t.onerror?.(new Error("boom")), 0)
      return t
    })
    const prova = await resolver({ desafio: "v1.falha", trabalho: 100 })
    expect(provaCumpre("v1.falha", prova.nonce, 100)).toBe(true)
  })
})
