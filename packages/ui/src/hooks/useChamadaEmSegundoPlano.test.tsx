import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useChamadaEmSegundoPlano } from "./useChamadaEmSegundoPlano.js"

/**
 * A call with the screen locked:
 * what the page tells the system while a call is open.
 *
 *  - Media Session (M5): the call's name, "playing", and the system's mute and
 *    hang-up buttons. `play` and `pause` do nothing on purpose: a "pause" on the
 *    lock screen would pause the elements the voices play in.
 *  - `navigator.audioSession` (M6, Safari only): "play-and-record" during the call.
 *  - Screen wake lock (Settings option): only with the page in front.
 */

type Handler = (() => void) | null

class SessaoFalsa {
  metadata: unknown = null
  playbackState = "none"
  readonly handlers = new Map<string, Handler>()
  recusar = new Set<string>()
  setActionHandler(accao: string, fazer: Handler): void {
    if (this.recusar.has(accao)) throw new TypeError(`"${accao}" is not a valid enum value`)
    this.handlers.set(accao, fazer)
  }
}

class Trinco {
  released = false
  readonly #ouvintes: (() => void)[] = []
  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    for (const ouvir of this.#ouvintes) ouvir()
  }
  addEventListener(_tipo: "release", ouvir: () => void): void {
    this.#ouvintes.push(ouvir)
  }
}

let sessao: SessaoFalsa
let audioSession: { type: string } | undefined
let trincos: Trinco[]
let visibilidade: DocumentVisibilityState

function navegador(opcoes: { semSessao?: boolean; semWakeLock?: boolean } = {}): void {
  const nav: Record<string, unknown> = {}
  if (!opcoes.semSessao) nav["mediaSession"] = sessao
  if (audioSession) nav["audioSession"] = audioSession
  if (!opcoes.semWakeLock) {
    nav["wakeLock"] = {
      request: vi.fn(async () => {
        const trinco = new Trinco()
        trincos.push(trinco)
        return trinco
      }),
    }
  }
  vi.stubGlobal("navigator", nav)
}

beforeEach(() => {
  sessao = new SessaoFalsa()
  audioSession = { type: "auto" }
  trincos = []
  visibilidade = "visible"
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilidade })
  vi.stubGlobal(
    "MediaMetadata",
    class {
      constructor(readonly dados: { title: string; artist: string }) {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

interface Props {
  emChamada: boolean
  titulo: string
  ecraLigado: boolean
}

function montar(inicial: Partial<Props> = {}) {
  const aoAlternarMicrofone = vi.fn()
  const aoSair = vi.fn()
  const vista = renderHook((p: Props) => useChamadaEmSegundoPlano({ ...p, aoAlternarMicrofone, aoSair }), {
    initialProps: { emChamada: true, titulo: "Geral", ecraLigado: false, ...inicial },
  })
  return { aoAlternarMicrofone, aoSair, ...vista }
}

async function assentar(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe("Media Session com o estado da chamada", () => {
  it("numa chamada: o nome da sala, a tocar, e os botões do sistema ligados à app", () => {
    navegador()
    const { aoAlternarMicrofone, aoSair } = montar()
    expect((sessao.metadata as { dados: { title: string } }).dados.title).toBe("Geral")
    expect(sessao.playbackState).toBe("playing")
    sessao.handlers.get("togglemicrophone")?.()
    expect(aoAlternarMicrofone).toHaveBeenCalledTimes(1)
    sessao.handlers.get("hangup")?.()
    expect(aoSair).toHaveBeenCalledTimes(1)
  })

  it("play e pause existem e não fazem nada: o ecrã bloqueado não pausa as vozes", () => {
    navegador()
    const { aoAlternarMicrofone, aoSair } = montar()
    expect(typeof sessao.handlers.get("pause")).toBe("function")
    expect(typeof sessao.handlers.get("play")).toBe("function")
    sessao.handlers.get("pause")?.()
    sessao.handlers.get("play")?.()
    expect(aoAlternarMicrofone).not.toHaveBeenCalled()
    expect(aoSair).not.toHaveBeenCalled()
    expect(sessao.playbackState).toBe("playing")
  })

  it("um browser sem hangup (Safari) recusa só esse, e o resto fica", () => {
    navegador()
    sessao.recusar.add("hangup")
    montar()
    expect(sessao.handlers.has("hangup")).toBe(false)
    expect(typeof sessao.handlers.get("togglemicrophone")).toBe("function")
  })

  it("ao sair: os botões soltam-se e a sessão fica vazia", () => {
    navegador()
    const { rerender } = montar()
    rerender({ emChamada: false, titulo: "", ecraLigado: false })
    expect(sessao.playbackState).toBe("none")
    expect(sessao.metadata).toBe(null)
    for (const accao of ["togglemicrophone", "hangup", "play", "pause"]) expect(sessao.handlers.get(accao)).toBe(null)
  })

  it("fora de chamada não toca na sessão", () => {
    navegador()
    montar({ emChamada: false })
    expect(sessao.playbackState).toBe("none")
    expect(sessao.handlers.size).toBe(0)
  })

  it("um browser sem Media Session nem audioSession nem wake lock não rebenta", () => {
    audioSession = undefined
    navegador({ semSessao: true, semWakeLock: true })
    expect(() => montar({ ecraLigado: true })).not.toThrow()
  })
})

describe("audioSession (Safari)", () => {
  it("numa chamada é play-and-record; ao sair volta ao que era", () => {
    navegador()
    const { rerender } = montar()
    expect(audioSession?.type).toBe("play-and-record")
    rerender({ emChamada: false, titulo: "", ecraLigado: false })
    expect(audioSession?.type).toBe("auto")
  })
})

describe("o ecrã ligado durante a chamada (opção)", () => {
  it("desligada, não pede nada", async () => {
    navegador()
    montar({ ecraLigado: false })
    await assentar()
    expect(trincos).toHaveLength(0)
  })

  it("ligada, pede o trinco na chamada e larga-o ao sair", async () => {
    navegador()
    const { rerender } = montar({ ecraLigado: true })
    await assentar()
    expect(trincos).toHaveLength(1)
    rerender({ emChamada: false, titulo: "", ecraLigado: true })
    await assentar()
    expect(trincos[0]!.released).toBe(true)
  })

  it("desligar a opção a meio da chamada larga o trinco", async () => {
    navegador()
    const { rerender } = montar({ ecraLigado: true })
    await assentar()
    rerender({ emChamada: true, titulo: "Geral", ecraLigado: false })
    await assentar()
    expect(trincos[0]!.released).toBe(true)
  })

  it("o sistema larga-o quando a página se esconde; ao voltar, pede outro", async () => {
    navegador()
    montar({ ecraLigado: true })
    await assentar()
    visibilidade = "hidden"
    await act(async () => {
      await trincos[0]!.release()
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(trincos).toHaveLength(1)
    visibilidade = "visible"
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await assentar()
    expect(trincos).toHaveLength(2)
  })

  it("com a página escondida não pede: o pedido seria recusado", async () => {
    navegador()
    visibilidade = "hidden"
    montar({ ecraLigado: true })
    await assentar()
    expect(trincos).toHaveLength(0)
  })
})
