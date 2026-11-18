import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render as baseRender } from "@testing-library/react"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { ToastProvider } from "../../components/Toast.js"
import { esquecerMarcasDeEntrada, writeLastRead } from "../../hooks/useUnreads.js"
import { MENCAO_VISTA_MS } from "../../hooks/useMencoesVistas.js"
import { citacaoDe, indiceDasCitacoes } from "../../lib/respostas.js"
import { chaveDaConversa, entrarNaConversa, esquecerEntradasNasConversas } from "../../lib/porLerPorSala.js"
import { Timeline } from "./Timeline.js"

/**
 * A mention lights while it is unread, and not forever (17/11/2026, the owner:
 * "it is a reply, but it stays marked forever").
 *
 * The rule: a line that mentions me (my address, `@all`, a role I hold, a reply
 * with "@ Mention" on) is lit when it is newer than the conversation's read mark
 * as it was on entry, the same mark the unread mention count uses. Seen for a
 * few seconds with the window in front, it fades. A reply that lights says why:
 * "@Name" on its quote line, like Discord.
 */

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> => baseRender(ui, { wrapper: ToastProvider })
const CANAL = "!sala:s"
const EU = "@eu:s"
const BRUNO = "@bruno:s"
const CONVERSA = chaveDaConversa(CANAL, "")
const noop = (): void => {}

const msg = (id: string, sentAt: number, extra: Partial<ChatMessage["payload"]> = {}, sender = BRUNO): ChatMessage => ({
  channel: CANAL,
  seq: sentAt,
  sender,
  payload: { t: "message", id, sentAt, body: `texto ${id}`, ...extra },
})

const timeline = (messages: ChatMessage[], conversa: string | undefined = CONVERSA): React.JSX.Element => (
  <Timeline
    channel={CANAL}
    {...(conversa !== undefined ? { conversa } : {})}
    messages={messages}
    pending={[]}
    onRetry={noop}
    onDiscard={noop}
    me={EU}
    nameFor={(endereco) => (endereco === EU ? "Eu" : endereco === BRUNO ? "Bruno" : endereco)}
    directory={new Map<string, Profile>()}
    onIrParaOriginal={noop}
    citacaoDe={(id) => citacaoDe(id, indiceDasCitacoes(messages, messages), false)}
  />
)

const linha = (id: string): HTMLElement => document.querySelector(`.message[data-mensagem="${id}"]`) as HTMLElement

/** A controllable `IntersectionObserver`: the test says which lines are in view. */
let observadores: { callback: IntersectionObserverCallback; alvos: Set<Element> }[] = []
class ObservadorFalso {
  readonly registo: { callback: IntersectionObserverCallback; alvos: Set<Element> }
  constructor(callback: IntersectionObserverCallback) {
    this.registo = { callback, alvos: new Set() }
    observadores.push(this.registo)
  }
  observe(alvo: Element): void {
    this.registo.alvos.add(alvo)
  }
  unobserve(alvo: Element): void {
    this.registo.alvos.delete(alvo)
  }
  disconnect(): void {
    this.registo.alvos.clear()
    observadores = observadores.filter((o) => o !== this.registo)
  }
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}
function aVista(id: string, visivel: boolean): void {
  act(() => {
    for (const { callback, alvos } of observadores) {
      for (const alvo of alvos) {
        if ((alvo as HTMLElement).dataset["mensagem"] !== id) continue
        const caixa = { top: 0, bottom: 40, height: 40, left: 0, right: 300, width: 300, x: 0, y: 0, toJSON: () => ({}) }
        callback(
          [
            {
              target: alvo,
              isIntersecting: visivel,
              intersectionRatio: visivel ? 1 : 0,
              intersectionRect: { ...caixa, height: visivel ? 40 : 0 },
              boundingClientRect: caixa,
              rootBounds: { ...caixa, height: 500, bottom: 500 },
              time: 0,
            } as unknown as IntersectionObserverEntry,
          ],
          {} as IntersectionObserver,
        )
      }
    }
  })
}

let foco = true
beforeEach(() => {
  localStorage.clear()
  esquecerMarcasDeEntrada()
  esquecerEntradasNasConversas()
  observadores = []
  foco = true
  vi.stubGlobal("IntersectionObserver", ObservadorFalso)
  vi.spyOn(document, "hasFocus").mockImplementation(() => foco)
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("uma menção acende enquanto não foi vista", () => {
  it("já lida na entrada não acende; nova acende", () => {
    entrarNaConversa(CONVERSA, 2000)
    render(timeline([msg("velha", 1000, { mentions: [EU] }), msg("nova", 3000, { mentions: [EU] })]))
    expect(linha("velha").classList.contains("menciona-me")).toBe(false)
    expect(linha("nova").classList.contains("menciona-me")).toBe(true)
  })

  it("numa conversa directa segue o marcador do canal", () => {
    writeLastRead({ [CANAL]: 2000 })
    render(timeline([msg("velha", 1000, { mentions: [EU] }), msg("nova", 3000, { mentions: [EU] })], undefined))
    expect(linha("velha").classList.contains("menciona-me")).toBe(false)
    expect(linha("nova").classList.contains("menciona-me")).toBe(true)
  })

  it("uma menção que chega com a conversa aberta acende", () => {
    entrarNaConversa(CONVERSA, 2000)
    const { rerender } = render(timeline([msg("a", 1000)]))
    rerender(timeline([msg("a", 1000), msg("chegou", 5000, { mentions: [EU] })]))
    expect(linha("chegou").classList.contains("menciona-me")).toBe(true)
  })

  it("vista uns segundos com a janela à frente, apaga-se; fora da vista, não", () => {
    vi.useFakeTimers()
    entrarNaConversa(CONVERSA, 0)
    render(timeline([msg("m1", 1000, { mentions: [EU] }), msg("m2", 2000, { mentions: [EU] })]))
    aVista("m1", true)
    act(() => {
      vi.advanceTimersByTime(MENCAO_VISTA_MS - 100)
    })
    expect(linha("m1").classList.contains("mencao-vista")).toBe(false)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(linha("m1").classList.contains("mencao-vista")).toBe(true)
    // Still lit for this visit, only fading: the class stays, the margin stays.
    expect(linha("m1").classList.contains("menciona-me")).toBe(true)
    expect(linha("m2").classList.contains("mencao-vista")).toBe(false)
  })

  it("com a janela atrás de outra, estar à vista não conta", () => {
    vi.useFakeTimers()
    foco = false
    entrarNaConversa(CONVERSA, 0)
    render(timeline([msg("m1", 1000, { mentions: [EU] })]))
    aVista("m1", true)
    act(() => {
      vi.advanceTimersByTime(MENCAO_VISTA_MS * 3)
    })
    expect(linha("m1").classList.contains("mencao-vista")).toBe(false)
  })

  it("sair da vista antes do tempo pára o relógio", () => {
    vi.useFakeTimers()
    entrarNaConversa(CONVERSA, 0)
    render(timeline([msg("m1", 1000, { mentions: [EU] })]))
    aVista("m1", true)
    act(() => {
      vi.advanceTimersByTime(MENCAO_VISTA_MS / 2)
    })
    aVista("m1", false)
    act(() => {
      vi.advanceTimersByTime(MENCAO_VISTA_MS * 2)
    })
    expect(linha("m1").classList.contains("mencao-vista")).toBe(false)
  })
})

describe("a resposta que menciona diz porquê", () => {
  it("a citação mostra @Nome quando a resposta mencionou o autor do original", () => {
    entrarNaConversa(CONVERSA, 0)
    render(
      timeline([
        msg("original", 1000, {}, EU),
        msg("resposta", 2000, { replyTo: "original", mentions: [EU] }),
        msg("semMencao", 3000, { replyTo: "original" }),
      ]),
    )
    const citacao = (id: string): string => linha(id).querySelector(".message-citacao-nome")?.textContent ?? ""
    expect(citacao("resposta")).toBe("@Eu")
    expect(citacao("semMencao")).toBe("Eu")
    expect(linha("resposta").classList.contains("menciona-me")).toBe(true)
    expect(linha("semMencao").classList.contains("menciona-me")).toBe(false)
  })
})
